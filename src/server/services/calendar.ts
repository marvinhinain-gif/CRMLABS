/**
 * Agenda pessoal integrada às reuniões do CRMLABS.
 *
 * 1. Link de assinatura (ICS): funciona em qualquer agenda (Google, Apple, Outlook) sem configuração.
 *    Somente leitura e com atraso definido por cada app (o Google atualiza a cada poucas horas).
 * 2. Google Agenda conectado (OAuth): cria, remarca e cancela o evento na hora, gera link do Meet
 *    e mostra os horários ocupados ao marcar uma reunião.
 */
import { and, eq, gt, gte, inArray, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { appointments, calendarConnections, contacts, memberships, oauthStates, users } from "../db/schema";
import type { Ctx } from "../context";
import { decryptSecret, encryptSecret, randomToken, sha256 } from "../crypto";
import { appUrl } from "../env";
import { AppError, forbidden, invalid } from "../errors";
import { assertCan, can } from "../permissions";
import { logger } from "../logger";
import { audit } from "./common";
import { assertInstanceAdmin, loadInstanceSettings, setInstanceSetting } from "./instance";
import { instanceCache } from "../env";

const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.freebusy", "openid", "email"];
const TZ = "America/Bahia";

// ---------- Configuração do app Google (administrador) ----------

export function googleRedirectUri() {
  return `${appUrl()}/api/calendar/google/callback`;
}

function googleClient() {
  const v = instanceCache.values;
  const clientId = process.env.GOOGLE_CLIENT_ID || v.get("google.client_id") || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || v.get("google.client_secret") || "";
  return { clientId, clientSecret, configured: !!(clientId && clientSecret) };
}

export async function googleSetupState(ctx: Ctx) {
  assertCan(ctx, "integrations.manage", "Somente administradores configuram a agenda.");
  await loadInstanceSettings();
  const g = googleClient();
  return { configured: g.configured, clientId: g.clientId, fromEnv: !!process.env.GOOGLE_CLIENT_ID, redirectUri: googleRedirectUri(), origin: new URL(appUrl()).origin };
}

export const googleClientSchema = z.object({
  clientId: z.string().trim().regex(/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/, "O ID do cliente termina com .apps.googleusercontent.com."),
  clientSecret: z.string().trim().max(200),
});

export async function saveGoogleClient(ctx: Ctx, input: z.infer<typeof googleClientSchema>) {
  await assertInstanceAdmin(ctx);
  await loadInstanceSettings(true);
  if (!input.clientSecret && !instanceCache.values.get("google.client_secret")) throw invalid("Informe a chave secreta do cliente.");
  await setInstanceSetting("google.client_id", input.clientId);
  if (input.clientSecret) await setInstanceSetting("google.client_secret", input.clientSecret);
  await audit(db, ctx, "instance.google_client_saved", "instance", null);
  return googleSetupState(ctx);
}

// ---------- Conexão de cada pessoa ----------

async function ensureConnection(ctx: Pick<Ctx, "userId" | "orgId">) {
  const [c] = await db.select().from(calendarConnections).where(eq(calendarConnections.userId, ctx.userId));
  if (c) return c;
  const token = randomToken(24);
  const [row] = await db
    .insert(calendarConnections)
    .values({ userId: ctx.userId, orgId: ctx.orgId, feedTokenHash: sha256(token), feedTokenEnc: encryptSecret(token) })
    .onConflictDoNothing()
    .returning();
  return row ?? (await db.select().from(calendarConnections).where(eq(calendarConnections.userId, ctx.userId)))[0];
}

function feedUrls(c: typeof calendarConnections.$inferSelect) {
  const token = decryptSecret(c.feedTokenEnc);
  const https = `${appUrl()}/api/public/calendar/${token}.ics`;
  const webcal = https.replace(/^https?:/, "webcal:");
  return { feedUrl: https, webcalUrl: webcal, googleAddUrl: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}` };
}

export async function myCalendar(ctx: Ctx) {
  await loadInstanceSettings();
  const c = await ensureConnection(ctx);
  return {
    ...feedUrls(c),
    google: {
      available: googleClient().configured,
      connected: !!c.googleRefreshEnc,
      email: c.googleEmail,
      connectedAt: c.googleConnectedAt,
      lastSyncAt: c.lastSyncAt,
      lastError: c.lastError,
      createMeet: c.createMeet,
    },
  };
}

export async function regenerateFeed(ctx: Ctx) {
  const c = await ensureConnection(ctx);
  const token = randomToken(24);
  await db.update(calendarConnections).set({ feedTokenHash: sha256(token), feedTokenEnc: encryptSecret(token) }).where(eq(calendarConnections.userId, c.userId));
  await audit(db, ctx, "calendar.feed_regenerated", "user", ctx.userId);
  return myCalendar(ctx);
}

export async function updatePrefs(ctx: Ctx, input: { createMeet?: boolean }) {
  await ensureConnection(ctx);
  if (input.createMeet !== undefined) await db.update(calendarConnections).set({ createMeet: input.createMeet }).where(eq(calendarConnections.userId, ctx.userId));
  return myCalendar(ctx);
}

// ---------- ICS (link de assinatura) ----------

const icsEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (m) => `\\${m}`);
const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
/** Linhas de no máximo 75 octetos (RFC 5545). */
function fold(line: string) {
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > 73) {
      out.push(cur);
      cur = " " + ch;
    } else cur += ch;
  }
  out.push(cur);
  return out.join("\r\n");
}

export async function icsFeed(tokenWithExt: string) {
  const token = tokenWithExt.replace(/\.ics$/, "");
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(token)) return null;
  const [c] = await db.select().from(calendarConnections).where(eq(calendarConnections.feedTokenHash, sha256(token)));
  if (!c) return null;
  const [m] = await db.select({ status: memberships.status }).from(memberships).where(and(eq(memberships.userId, c.userId), eq(memberships.orgId, c.orgId)));
  if (!m || m.status !== "active") return null;
  const since = new Date(Date.now() - 60 * 86400000);
  const rows = await db
    .select({
      id: appointments.id,
      title: appointments.title,
      startsAt: appointments.startsAt,
      endsAt: appointments.endsAt,
      location: appointments.location,
      status: appointments.status,
      notes: appointments.notes,
      updatedAt: appointments.updatedAt,
      contactName: contacts.name,
      contactPhone: contacts.phone,
      contactId: contacts.id,
    })
    .from(appointments)
    .innerJoin(contacts, eq(contacts.id, appointments.contactId))
    .where(and(eq(appointments.orgId, c.orgId), eq(appointments.ownerId, c.userId), gte(appointments.startsAt, since)))
    .limit(1000);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CRMLABS//Agenda//PT-BR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:CRMLABS — Reuniões", `X-WR-TIMEZONE:${TZ}`, "REFRESH-INTERVAL;VALUE=DURATION:PT30M", "X-PUBLISHED-TTL:PT30M"];
  for (const a of rows) {
    const desc = [
      `Cliente: ${a.contactName}`,
      a.contactPhone ? `WhatsApp: https://wa.me/${a.contactPhone.replace(/\D/g, "")}` : null,
      a.notes ? `\n${a.notes}` : null,
      `\nAbrir no CRMLABS: ${appUrl()}/agendamentos?reuniao=${a.id}`,
    ]
      .filter(Boolean)
      .join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${a.id}@crmlabs`,
      `DTSTAMP:${icsDate(a.updatedAt)}`,
      `LAST-MODIFIED:${icsDate(a.updatedAt)}`,
      `SEQUENCE:${Math.floor(a.updatedAt.getTime() / 1000)}`,
      `DTSTART:${icsDate(a.startsAt)}`,
      `DTEND:${icsDate(a.endsAt)}`,
      fold(`SUMMARY:${icsEscape(`${a.status === "canceled" ? "[Cancelada] " : ""}${a.title}`)}`),
      fold(`DESCRIPTION:${icsEscape(desc)}`),
      ...(a.location ? [fold(`LOCATION:${icsEscape(a.location)}`)] : []),
      ...(a.location && /^https?:\/\//.test(a.location) ? [fold(`URL:${a.location}`)] : []),
      `STATUS:${a.status === "canceled" ? "CANCELLED" : "CONFIRMED"}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

// ---------- Google: OAuth ----------

export async function startGoogleConnect(ctx: Ctx) {
  await loadInstanceSettings();
  const g = googleClient();
  if (!g.configured) throw new AppError("channel_unavailable", "O administrador ainda não configurou a conexão com o Google Agenda em Integrações.");
  await ensureConnection(ctx);
  const state = randomToken(24);
  await db.insert(oauthStates).values({ stateHash: sha256(state), orgId: ctx.orgId, userId: ctx.userId, purpose: "google_calendar", expiresAt: new Date(Date.now() + 10 * 60 * 1000) });
  const q = new URLSearchParams({
    client_id: g.clientId,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${q}` };
}

async function googleFetch<T>(url: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  const { token: _t, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  let res: Response;
  try {
    res = await fetch(url, { ...rest, headers, signal: controller.signal, cache: "no-store" });
  } catch {
    throw new AppError("provider_error", "Não foi possível falar com o Google agora.");
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    const err = body.error as { message?: string } | string | undefined;
    const msg = typeof err === "string" ? `${err}${body.error_description ? `: ${body.error_description}` : ""}` : (err?.message ?? `HTTP ${res.status}`);
    throw Object.assign(new AppError("provider_error", `Google: ${msg}`), { httpStatus: res.status });
  }
  return body as T;
}

export async function handleGoogleCallback(params: { code?: string | null; state?: string | null; error?: string | null }, sessionCtx: Ctx | null) {
  await loadInstanceSettings();
  if (!params.state) throw invalid("Retorno do Google sem state.");
  const [st] = await db
    .update(oauthStates)
    .set({ usedAt: new Date() })
    .where(and(eq(oauthStates.stateHash, sha256(params.state)), eq(oauthStates.purpose, "google_calendar"), isNull(oauthStates.usedAt), gt(oauthStates.expiresAt, new Date())))
    .returning();
  if (!st) throw invalid("Pedido de conexão expirado. Tente conectar de novo.");
  if (!sessionCtx || sessionCtx.userId !== st.userId || sessionCtx.orgId !== st.orgId) throw forbidden("Conclua a conexão na mesma sessão em que ela começou.");
  if (params.error) throw invalid("A autorização foi cancelada no Google.");
  if (!params.code) throw invalid("Retorno do Google sem código de autorização.");
  const g = googleClient();
  const tok = await googleFetch<{ access_token: string; refresh_token?: string; scope?: string; id_token?: string }>("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code: params.code, client_id: g.clientId, client_secret: g.clientSecret, redirect_uri: googleRedirectUri(), grant_type: "authorization_code" }),
  });
  if (!tok.refresh_token) throw invalid("O Google não liberou acesso contínuo. Remova o CRMLABS em myaccount.google.com/permissions e conecte de novo.");
  if (!tok.scope?.includes("calendar.events")) throw invalid("Permissão de agenda não concedida. Marque a opção de ver e editar eventos ao autorizar.");
  const cal = await googleFetch<{ id: string; summary?: string }>("https://www.googleapis.com/calendar/v3/calendars/primary", { token: tok.access_token });
  await db
    .update(calendarConnections)
    .set({ googleEmail: cal.id, googleRefreshEnc: encryptSecret(tok.refresh_token), googleConnectedAt: new Date(), lastError: null })
    .where(eq(calendarConnections.userId, st.userId));
  await audit(db, sessionCtx, "calendar.google_connected", "user", st.userId, { email: cal.id });
  // Reuniões futuras já entram na agenda.
  void syncUpcoming(st.userId).catch((e) => logger.warn("Falha ao sincronizar reuniões futuras", e));
  return { email: cal.id };
}

export async function disconnectGoogle(ctx: Ctx) {
  const [c] = await db.select().from(calendarConnections).where(eq(calendarConnections.userId, ctx.userId));
  if (c?.googleRefreshEnc) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(decryptSecret(c.googleRefreshEnc))}`, { method: "POST" });
    } catch {
      /* revogação é melhor esforço */
    }
  }
  await db.update(calendarConnections).set({ googleEmail: null, googleRefreshEnc: null, googleConnectedAt: null, lastError: null }).where(eq(calendarConnections.userId, ctx.userId));
  await audit(db, ctx, "calendar.google_disconnected", "user", ctx.userId);
  return myCalendar(ctx);
}

async function accessTokenFor(userId: string) {
  await loadInstanceSettings();
  const [c] = await db.select().from(calendarConnections).where(eq(calendarConnections.userId, userId));
  if (!c?.googleRefreshEnc) return null;
  const g = googleClient();
  if (!g.configured) return null;
  try {
    const tok = await googleFetch<{ access_token: string }>("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ refresh_token: decryptSecret(c.googleRefreshEnc), client_id: g.clientId, client_secret: g.clientSecret, grant_type: "refresh_token" }),
    });
    return { token: tok.access_token, conn: c };
  } catch (e) {
    const msg = (e as Error).message;
    await db.update(calendarConnections).set({ lastError: msg.includes("invalid_grant") ? "A conexão com o Google expirou ou foi removida. Conecte de novo." : msg.slice(0, 300) }).where(eq(calendarConnections.userId, userId));
    return null;
  }
}

// ---------- Google: eventos ----------

const eventId = (appointmentId: string) => `crm${appointmentId.replace(/-/g, "")}`;

/**
 * Leva a reunião para a agenda Google do responsável (cria, atualiza ou cancela).
 * Nunca falha a operação principal: erros ficam registrados na conexão.
 */
export async function syncAppointment(appointmentId: string) {
  const [a] = await db
    .select({ a: appointments, contactName: contacts.name, contactPhone: contacts.phone })
    .from(appointments)
    .innerJoin(contacts, eq(contacts.id, appointments.contactId))
    .where(eq(appointments.id, appointmentId));
  if (!a?.a.ownerId) return null;
  const auth = await accessTokenFor(a.a.ownerId);
  if (!auth) return null;
  const { token, conn } = auth;
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(conn.googleCalendarId)}/events`;
  const id = a.a.googleEventId ?? eventId(a.a.id);
  try {
    if (a.a.status === "canceled") {
      if (a.a.googleEventId) {
        await googleFetch(`${base}/${id}?sendUpdates=none`, { method: "PATCH", token, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "cancelled" }) });
      }
    } else {
      const wantsMeet = conn.createMeet && !a.a.location;
      const body: Record<string, unknown> = {
        summary: a.a.title,
        description: [
          `Cliente: ${a.contactName}`,
          a.contactPhone ? `WhatsApp: https://wa.me/${a.contactPhone.replace(/\D/g, "")}` : null,
          a.a.notes ? `\n${a.a.notes}` : null,
          `\nAbrir no CRMLABS: ${appUrl()}/agendamentos?reuniao=${a.a.id}`,
        ]
          .filter(Boolean)
          .join("\n"),
        start: { dateTime: a.a.startsAt.toISOString(), timeZone: a.a.timezone || TZ },
        end: { dateTime: a.a.endsAt.toISOString(), timeZone: a.a.timezone || TZ },
        location: a.a.location ?? undefined,
        status: "confirmed",
        source: { title: "CRMLABS", url: `${appUrl()}/agendamentos?reuniao=${a.a.id}` },
        extendedProperties: { private: { crmlabsAppointmentId: a.a.id } },
        reminders: { useDefault: true },
      };
      if (wantsMeet) body.conferenceData = { createRequest: { requestId: `crm-${a.a.id}`, conferenceSolutionKey: { type: "hangoutsMeet" } } };
      let ev: { id: string; hangoutLink?: string };
      if (a.a.googleEventId) {
        ev = await googleFetch(`${base}/${id}?conferenceDataVersion=1&sendUpdates=none`, { method: "PATCH", token, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      } else {
        try {
          ev = await googleFetch(`${base}?conferenceDataVersion=1&sendUpdates=none`, { method: "POST", token, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, id }) });
        } catch (e) {
          // Já existia (ex.: nova tentativa): atualiza.
          if ((e as { httpStatus?: number }).httpStatus !== 409) throw e;
          ev = await googleFetch(`${base}/${id}?conferenceDataVersion=1&sendUpdates=none`, { method: "PATCH", token, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        }
      }
      await db
        .update(appointments)
        .set({ googleEventId: ev.id, calendarSyncedAt: new Date(), ...(wantsMeet && ev.hangoutLink ? { location: ev.hangoutLink } : {}) })
        .where(eq(appointments.id, a.a.id));
    }
    await db.update(calendarConnections).set({ lastSyncAt: new Date(), lastError: null }).where(eq(calendarConnections.userId, conn.userId));
    return true;
  } catch (e) {
    await db.update(calendarConnections).set({ lastError: (e as Error).message.slice(0, 300) }).where(eq(calendarConnections.userId, conn.userId));
    logger.warn("Falha ao sincronizar reunião com o Google Agenda", e);
    return false;
  }
}

/** Ao conectar: leva as reuniões futuras já marcadas. */
export async function syncUpcoming(userId: string) {
  const rows = await db
    .select({ id: appointments.id })
    .from(appointments)
    .where(and(eq(appointments.ownerId, userId), gt(appointments.startsAt, new Date()), eq(appointments.status, "scheduled")))
    .limit(100);
  for (const r of rows) await syncAppointment(r.id);
}

/** Dispara a sincronização sem atrasar a resposta. */
export function syncSoon(appointmentId: string) {
  if (process.env.VITEST === "true") return;
  setTimeout(() => void syncAppointment(appointmentId).catch((e) => logger.warn("Sincronização de agenda falhou", e)), 50);
}

// ---------- Horários ocupados ----------

export const busySchema = z.object({ ownerId: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), excludeId: z.string().uuid().optional() });

/** Horários ocupados do responsável no dia: reuniões do CRM + agenda Google (se conectada). */
export async function busyTimes(ctx: Ctx, input: z.infer<typeof busySchema>) {
  if (input.ownerId !== ctx.userId && !can(ctx, "contacts.assign")) {
    const [m] = await db.select({ role: memberships.role }).from(memberships).where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, input.ownerId), eq(memberships.status, "active")));
    if (m?.role !== "closer") throw forbidden("Você só vê a agenda de closers e a sua.");
  }
  const from = new Date(`${input.date}T00:00:00-03:00`);
  const to = new Date(from.getTime() + 86400000);
  const crm = await db
    .select({ start: appointments.startsAt, end: appointments.endsAt, title: appointments.title, id: appointments.id })
    .from(appointments)
    .where(and(eq(appointments.orgId, ctx.orgId), eq(appointments.ownerId, input.ownerId), inArray(appointments.status, ["scheduled"]), lt(appointments.startsAt, to), gt(appointments.endsAt, from)));
  const excluded = crm.find((r) => r.id === input.excludeId);
  const busy: { start: string; end: string; source: "crm" | "google"; label?: string }[] = crm
    .filter((r) => r.id !== input.excludeId)
    .map((r) => ({ start: r.start.toISOString(), end: r.end.toISOString(), source: "crm", label: r.title }));
  let google: "connected" | "not_connected" | "error" = "not_connected";
  const auth = await accessTokenFor(input.ownerId);
  if (auth) {
    try {
      const fb = await googleFetch<{ calendars: Record<string, { busy: { start: string; end: string }[] }> }>("https://www.googleapis.com/calendar/v3/freeBusy", {
        method: "POST",
        token: auth.token,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), timeZone: TZ, items: [{ id: auth.conn.googleCalendarId }] }),
      });
      google = "connected";
      for (const b of Object.values(fb.calendars ?? {}).flatMap((c) => c.busy ?? [])) {
        // Não repete o que já é reunião do CRM.
        const same = (t: Date | string) => Math.abs(new Date(t).getTime() - new Date(b.start).getTime()) < 60000;
        if (excluded && same(excluded.start)) continue;
        if (!busy.some((x) => x.source === "crm" && same(x.start))) busy.push({ start: b.start, end: b.end, source: "google" });
      }
    } catch {
      google = "error";
    }
  }
  const [owner] = await db.select({ name: users.name }).from(users).where(eq(users.id, input.ownerId));
  return { ownerName: owner?.name ?? "", google, busy: busy.sort((a, b) => a.start.localeCompare(b.start)) };
}

