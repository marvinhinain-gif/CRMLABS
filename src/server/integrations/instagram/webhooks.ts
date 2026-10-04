import { and, eq, inArray, lte, ne, sql } from "drizzle-orm";
import { db } from "../../db";
import { connectedAccounts, webhookEvents } from "../../db/schema";
import { hmacSha256Hex, safeEqual, sha256 } from "../../crypto";
import { instagramConfig } from "../../env";
import { logger } from "../../logger";
import { processEvent } from "./processor";

/** Valida X-Hub-Signature-256 sobre o corpo bruto com o App Secret. */
export function verifySignature(rawBody: string, header: string | null): boolean {
  const secret = instagramConfig().appSecret;
  if (!secret || !header?.startsWith("sha256=")) return false;
  return safeEqual(header.slice(7), hmacSha256Hex(secret, rawBody));
}

type Messaging = {
  sender?: { id: string };
  recipient?: { id: string };
  timestamp?: number;
  message?: { mid: string; text?: string; is_echo?: boolean; is_deleted?: boolean; attachments?: { type: string; payload?: { url?: string } }[] };
  read?: { mid?: string; watermark?: number };
};
type Change = { field: string; value: Record<string, unknown> };
type Payload = { object?: string; entry?: { id: string; time?: number; messaging?: Messaging[]; changes?: Change[] }[] };

export type NormalizedEvent = { key: string; accountExternalId: string; field: string; data: Record<string, unknown> };

/** Separa o payload em eventos individuais com chave de deduplicação (conta + id do evento). */
export function splitPayload(payload: Payload): NormalizedEvent[] {
  const out: NormalizedEvent[] = [];
  for (const entry of payload.entry ?? []) {
    const acc = String(entry.id);
    const items: Messaging[] = [...(entry.messaging ?? [])];
    for (const ch of entry.changes ?? []) {
      if (ch.field === "messages") items.push(ch.value as Messaging);
      else if (ch.field === "comments" || ch.field === "live_comments") {
        const id = String(ch.value.id ?? "");
        out.push({ key: `comment:${acc}:${id || sha256(JSON.stringify(ch.value))}`, accountExternalId: acc, field: "comments", data: ch.value });
      } else {
        out.push({ key: `${ch.field}:${acc}:${sha256(JSON.stringify(ch.value))}`, accountExternalId: acc, field: ch.field, data: ch.value });
      }
    }
    for (const m of items) {
      if (m.message?.mid) {
        const field = m.message.is_deleted ? "message_deleted" : "messages";
        out.push({ key: `${field}:${acc}:${m.message.mid}`, accountExternalId: acc, field, data: m as Record<string, unknown> });
      } else if (m.read) {
        out.push({ key: `read:${acc}:${m.sender?.id}:${m.read.mid ?? m.read.watermark}`, accountExternalId: acc, field: "read", data: m as Record<string, unknown> });
      } else {
        out.push({ key: `other:${acc}:${sha256(JSON.stringify(m))}`, accountExternalId: acc, field: "other", data: m as Record<string, unknown> });
      }
    }
  }
  return out;
}

/**
 * Persiste os eventos (fila durável) e retorna rápido. Reentregas com a mesma chave são ignoradas.
 * Retorna quantos eventos novos foram enfileirados.
 */
export async function ingestWebhook(rawBody: string): Promise<{ queued: number; duplicates: number }> {
  let payload: Payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { queued: 0, duplicates: 0 };
  }
  if (payload.object && payload.object !== "instagram") return { queued: 0, duplicates: 0 };
  const events = splitPayload(payload);
  if (!events.length) return { queued: 0, duplicates: 0 };

  const accounts = await db
    .select({ externalAccountId: connectedAccounts.externalAccountId, orgId: connectedAccounts.orgId })
    .from(connectedAccounts)
    .where(and(inArray(connectedAccounts.externalAccountId, [...new Set(events.map((e) => e.accountExternalId))]), ne(connectedAccounts.status, "disconnected")));
  const orgByAccount = new Map(accounts.map((a) => [a.externalAccountId, a.orgId]));

  const inserted = await db
    .insert(webhookEvents)
    .values(
      events.map((e) => ({
        provider: "instagram",
        eventKey: e.key,
        accountExternalId: e.accountExternalId,
        orgId: orgByAccount.get(e.accountExternalId) ?? null,
        field: e.field,
        payload: e.data,
        status: (orgByAccount.has(e.accountExternalId) ? "received" : "ignored") as "received" | "ignored",
        lastError: orgByAccount.has(e.accountExternalId) ? null : "Conta não conectada a nenhuma organização",
      })),
    )
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id });
  return { queued: inserted.length, duplicates: events.length - inserted.length };
}

const MAX_ATTEMPTS = 8;

/** Backoff exponencial: 30 s, 1 min, 2 min… até ~1 h. */
export function backoffMs(attempt: number) {
  return Math.min(30_000 * 2 ** (attempt - 1), 60 * 60 * 1000);
}

/**
 * Processa a fila. `FOR UPDATE SKIP LOCKED` permite vários workers sem processamento duplicado.
 * Eventos fora de ordem são tolerados pelo processador (atualizações usam o horário do provedor).
 */
export async function processPendingEvents(limit = 50) {
  let processed = 0;
  for (let i = 0; i < limit; i++) {
    const done = await db.transaction(async (tx) => {
      const [ev] = await tx
        .select()
        .from(webhookEvents)
        .where(and(inArray(webhookEvents.status, ["received", "failed"]), lte(webhookEvents.nextAttemptAt, sql`clock_timestamp()`), sql`${webhookEvents.attempts} < ${MAX_ATTEMPTS}`))
        .orderBy(webhookEvents.receivedAt)
        .limit(1)
        .for("update", { skipLocked: true });
      if (!ev) return false;
      try {
        await processEvent(ev);
        await tx.update(webhookEvents).set({ status: "processed", processedAt: new Date(), attempts: ev.attempts + 1, lastError: null }).where(eq(webhookEvents.id, ev.id));
      } catch (e) {
        const attempts = ev.attempts + 1;
        logger.warn(`Falha ao processar evento ${ev.id} (tentativa ${attempts})`, e);
        await tx
          .update(webhookEvents)
          .set({ status: "failed", attempts, lastError: (e as Error).message.slice(0, 500), nextAttemptAt: new Date(Date.now() + backoffMs(attempts)) })
          .where(eq(webhookEvents.id, ev.id));
      }
      return true;
    });
    if (!done) break;
    processed++;
  }
  return processed;
}
