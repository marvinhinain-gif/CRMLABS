import webpush from "web-push";
import { and, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { instanceSettings, memberships, notifications, pushSubscriptions } from "../db/schema";
import type { Ctx } from "../context";
import { appUrl } from "../env";
import { encryptSecret } from "../crypto";
import { AppError, invalid } from "../errors";
import { logger } from "../logger";
import { prefEnabled, NOTIFY_PREFS, type NotifyPrefKey } from "@/lib/notificationTypes";
import { loadInstanceSettings } from "./instance";

/** Serviços de push dos navegadores. O servidor só envia para esses endereços (evita SSRF). */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/];

export function isAllowedEndpoint(endpoint: string) {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && !u.port && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

/** Chaves VAPID da instalação: geradas uma única vez e guardadas (a privada criptografada). */
export async function vapidKeys() {
  let v = await loadInstanceSettings();
  if (!v.get("push.vapid_public") || !v.get("push.vapid_private")) {
    const keys = webpush.generateVAPIDKeys();
    // Se dois servidores gerarem ao mesmo tempo, o primeiro a gravar vence.
    await db
      .insert(instanceSettings)
      .values([
        { key: "push.vapid_public", value: keys.publicKey },
        { key: "push.vapid_private", value: encryptSecret(keys.privateKey) },
      ])
      .onConflictDoNothing();
    v = await loadInstanceSettings(true);
  }
  return { publicKey: v.get("push.vapid_public")!, privateKey: v.get("push.vapid_private")! };
}

function vapidSubject() {
  const url = appUrl();
  return url.startsWith("https://") ? url : "mailto:notificacoes@crmlabs.invalid";
}

export const subscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(16).max(200), auth: z.string().min(8).max(100) }),
});

export async function subscribe(ctx: Ctx, input: z.infer<typeof subscribeSchema>, userAgent: string | null) {
  if (!isAllowedEndpoint(input.endpoint)) throw invalid("Este navegador usa um serviço de notificações não suportado.");
  await db
    .insert(pushSubscriptions)
    .values({ userId: ctx.userId, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: userAgent?.slice(0, 300) ?? null })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      // O aparelho pode ter trocado de conta: a inscrição passa a ser de quem está logado agora.
      set: { userId: ctx.userId, p256dh: input.keys.p256dh, auth: input.keys.auth, failures: 0, userAgent: userAgent?.slice(0, 300) ?? null },
    });
  return { ok: true };
}

export async function unsubscribe(ctx: Ctx, endpoint: string) {
  await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, ctx.userId), eq(pushSubscriptions.endpoint, endpoint)));
}

export async function deviceCount(userId: string) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  return r?.n ?? 0;
}

type Payload = { title: string; body?: string | null; url?: string | null; tag?: string; id?: string };

/** Envia para todos os aparelhos do usuário. Remove inscrições expiradas. Retorna quantos receberam. */
export async function sendToUser(userId: string, payload: Payload) {
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  if (!subs.length) return 0;
  const keys = await vapidKeys();
  const body = JSON.stringify({ title: payload.title, body: payload.body ?? "", url: payload.url ?? "/dashboard", tag: payload.tag, id: payload.id });
  let delivered = 0;
  await Promise.all(
    subs.map(async (s) => {
      if (!isAllowedEndpoint(s.endpoint)) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
        return;
      }
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
          vapidDetails: { subject: vapidSubject(), publicKey: keys.publicKey, privateKey: keys.privateKey },
          TTL: 6 * 3600,
          urgency: "high",
          timeout: 10_000,
        });
        delivered++;
        await db.update(pushSubscriptions).set({ lastSuccessAt: new Date(), failures: 0 }).where(eq(pushSubscriptions.id, s.id));
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410 || status === 403) {
          // Inscrição cancelada no aparelho (app removido, permissão retirada, chave trocada).
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
        } else {
          logger.warn(`Falha ao enviar push (HTTP ${status ?? "?"})`);
          await db
            .update(pushSubscriptions)
            .set({ failures: sql`${pushSubscriptions.failures} + 1` })
            .where(eq(pushSubscriptions.id, s.id));
          await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.id, s.id), gt(pushSubscriptions.failures, 20)));
        }
      }
    }),
  );
  return delivered;
}

export async function sendTest(ctx: Ctx) {
  const n = await sendToUser(ctx.userId, { title: "CRMLABS", body: "Pronto! As notificações estão chegando neste aparelho.", url: "/dashboard", tag: "test" });
  if (!n) throw new AppError("invalid", "Nenhum aparelho recebeu. Ative as notificações neste aparelho e tente de novo.");
  return { delivered: n };
}

/**
 * Entrega no celular as notificações recém-criadas. Cada notificação é processada uma única vez
 * (marcada antes do envio); as antigas (mais de 15 min) são descartadas sem envio.
 */
export async function dispatchPendingPush(limit = 50) {
  const batch = await db.transaction(async (tx) => {
    await tx
      .update(notifications)
      .set({ pushedAt: new Date() })
      .where(and(isNull(notifications.pushedAt), lte(notifications.createdAt, sql`now() - interval '15 minutes'`)));
    const rows = await tx
      .select({ id: notifications.id, orgId: notifications.orgId, userId: notifications.userId, type: notifications.type, title: notifications.title, body: notifications.body, link: notifications.link })
      .from(notifications)
      .where(isNull(notifications.pushedAt))
      .orderBy(notifications.createdAt)
      .limit(limit)
      .for("update", { skipLocked: true });
    if (rows.length) await tx.update(notifications).set({ pushedAt: new Date() }).where(inArray(notifications.id, rows.map((r) => r.id)));
    return rows;
  });
  if (!batch.length) return 0;
  const prefs = await db
    .select({ orgId: memberships.orgId, userId: memberships.userId, prefs: memberships.notifyPrefs })
    .from(memberships)
    .where(inArray(memberships.userId, [...new Set(batch.map((b) => b.userId))]));
  const prefOf = (orgId: string, userId: string) => prefs.find((p) => p.orgId === orgId && p.userId === userId)?.prefs;
  let sent = 0;
  for (const n of batch) {
    if (!prefEnabled(prefOf(n.orgId, n.userId), n.type)) continue;
    try {
      sent += await sendToUser(n.userId, { title: n.title, body: n.body, url: n.link, tag: n.type, id: n.id });
    } catch (e) {
      logger.warn("Falha ao entregar notificação no celular", e);
    }
  }
  return sent;
}

// ---------- Preferências ----------
export async function getPrefs(ctx: Ctx) {
  const [m] = await db.select({ prefs: memberships.notifyPrefs }).from(memberships).where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, ctx.userId)));
  const isAdmin = ctx.role === "admin";
  const available = NOTIFY_PREFS.filter((p) => !p.adminOnly || isAdmin);
  return {
    prefs: Object.fromEntries(available.map((p) => [p.key, m?.prefs?.[p.key] !== false])) as Record<NotifyPrefKey, boolean>,
    devices: await deviceCount(ctx.userId),
    publicKey: (await vapidKeys()).publicKey,
  };
}

export const prefsSchema = z.partialRecord(z.enum(NOTIFY_PREFS.map((p) => p.key) as [NotifyPrefKey, ...NotifyPrefKey[]]), z.boolean());

export async function setPrefs(ctx: Ctx, input: z.infer<typeof prefsSchema>) {
  const [m] = await db.select({ prefs: memberships.notifyPrefs }).from(memberships).where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, ctx.userId)));
  const next = { ...(m?.prefs ?? {}), ...input };
  await db.update(memberships).set({ notifyPrefs: next }).where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, ctx.userId)));
  return getPrefs(ctx);
}
