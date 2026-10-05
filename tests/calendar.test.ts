import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { appointments, calendarConnections } from "@/server/db/schema";
import { encryptSecret } from "@/server/crypto";
import { busyTimes, handleGoogleCallback, icsFeed, myCalendar, regenerateFeed, saveGoogleClient, startGoogleConnect, syncAppointment } from "@/server/services/calendar";
import { createAppointment, updateAppointment } from "@/server/services/commercial";
import { createContact } from "@/server/services/contacts";
import { loadInstanceSettings } from "@/server/services/instance";
import { setupOrg } from "./helpers";

const calls: { url: string; method: string; body: string }[] = [];
function mockGoogle(handler: (url: string, init: RequestInit) => unknown) {
  vi.stubGlobal("fetch", async (url: string | URL, init: RequestInit = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method ?? "GET", body: typeof init.body === "string" ? init.body : init.body ? String(init.body) : "" });
    const out = handler(u, init) as { status?: number; body: unknown };
    return new Response(JSON.stringify(out.body), { status: out.status ?? 200, headers: { "Content-Type": "application/json" } });
  });
}
afterEach(() => {
  calls.length = 0;
  vi.unstubAllGlobals();
});

const tomorrowAt = (h: number) => {
  const d = new Date(Date.now() + 86400000);
  return new Date(`${d.toISOString().slice(0, 10)}T${String(h).padStart(2, "0")}:00:00-03:00`);
};

describe("agenda do closer", () => {
  it("link de assinatura (ICS) traz as reuniões do closer e só dele", async () => {
    const { ctx, users: u } = await setupOrg();
    const c = await createContact(ctx.admin, { name: "Pedro Lima", phone: "+5571988887777" });
    const a = await createAppointment(ctx.admin, { contactId: c.id, ownerId: u.closer.id, title: "Diagnóstico, parte 1", startsAt: tomorrowAt(14), endsAt: tomorrowAt(15), timezone: "America/Bahia", location: "https://meet.google.com/abc" });
    await createAppointment(ctx.admin, { contactId: c.id, ownerId: u.seller.id, title: "Outra", startsAt: tomorrowAt(16), endsAt: tomorrowAt(17), timezone: "America/Bahia" });
    const cal = await myCalendar(ctx.closer);
    expect(cal.feedUrl).toMatch(/\/api\/public\/calendar\/[A-Za-z0-9_-]+\.ics$/);
    expect(cal.googleAddUrl).toContain("calendar.google.com");
    const ics = (await icsFeed(cal.feedUrl.split("/").pop()!))!;
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain(`UID:${a.id}@crmlabs`);
    expect(ics).toContain("SUMMARY:Diagnóstico\\, parte 1");
    expect(ics).toContain("wa.me/5571988887777");
    expect(ics).not.toContain("Outra");
    expect(ics.split("\r\n").every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
    await updateAppointment(ctx.admin, a.id, { status: "canceled" });
    expect(await icsFeed(cal.feedUrl.split("/").pop()!)).toContain("STATUS:CANCELLED");
    const fresh = await regenerateFeed(ctx.closer);
    expect(await icsFeed(cal.feedUrl.split("/").pop()!)).toBeNull();
    expect(await icsFeed(fresh.feedUrl.split("/").pop()!)).toContain("BEGIN:VCALENDAR");
  });

  it("Google: conecta pelo OAuth, cria evento com Meet, remarca e cancela", async () => {
    const { ctx, users: u } = await setupOrg();
    await expect(startGoogleConnect(ctx.closer)).rejects.toMatchObject({ code: "channel_unavailable" });
    await saveGoogleClient(ctx.admin, { clientId: "123456-abc.apps.googleusercontent.com", clientSecret: "segredo-google" });
    await expect(saveGoogleClient(ctx.closer, { clientId: "1-a.apps.googleusercontent.com", clientSecret: "x" })).rejects.toMatchObject({ code: "forbidden" });
    const { url } = await startGoogleConnect(ctx.closer);
    const state = new URL(url).searchParams.get("state")!;
    expect(new URL(url).searchParams.get("scope")).toContain("calendar.events");
    mockGoogle((u2) => {
      if (u2.includes("oauth2.googleapis.com/token")) return { body: { access_token: "AT", refresh_token: "RT", scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy" } };
      if (u2.includes("/calendars/primary") && !u2.includes("/events")) return { body: { id: "carla@empresa.com" } };
      return { body: {} };
    });
    await expect(handleGoogleCallback({ code: "c", state }, ctx.seller)).rejects.toMatchObject({ code: "forbidden" });
    const { url: url2 } = await startGoogleConnect(ctx.closer);
    await handleGoogleCallback({ code: "c", state: new URL(url2).searchParams.get("state") }, ctx.closer);
    const cal = await myCalendar(ctx.closer);
    expect(cal.google).toMatchObject({ connected: true, email: "carla@empresa.com" });
    const [conn] = await db.select().from(calendarConnections).where(eq(calendarConnections.userId, u.closer.id));
    expect(conn.googleRefreshEnc).not.toContain("RT");

    calls.length = 0;
    mockGoogle((u2, init) => {
      if (u2.includes("oauth2.googleapis.com/token")) return { body: { access_token: "AT2" } };
      if (u2.includes("/events") && init.method === "POST") return { body: { id: JSON.parse(String(init.body)).id, hangoutLink: "https://meet.google.com/xyz-abcd-efg" } };
      if (u2.includes("/events/") && init.method === "PATCH") return { body: { id: u2.split("/events/")[1].split("?")[0] } };
      return { body: {} };
    });
    const c = await createContact(ctx.admin, { name: "Rita" });
    const a = await createAppointment(ctx.admin, { contactId: c.id, ownerId: u.closer.id, title: "Call Rita", startsAt: tomorrowAt(10), endsAt: tomorrowAt(11), timezone: "America/Bahia" });
    expect(await syncAppointment(a.id)).toBe(true);
    const insert = calls.find((x) => x.method === "POST" && x.url.includes("/events"))!;
    expect(insert.url).toContain("conferenceDataVersion=1");
    expect(JSON.parse(insert.body)).toMatchObject({ summary: "Call Rita", conferenceData: { createRequest: { conferenceSolutionKey: { type: "hangoutsMeet" } } } });
    let [row] = await db.select().from(appointments).where(eq(appointments.id, a.id));
    expect(row.location).toBe("https://meet.google.com/xyz-abcd-efg");
    expect(row.googleEventId).toBe(`crm${a.id.replace(/-/g, "")}`);
    await updateAppointment(ctx.admin, a.id, { startsAt: tomorrowAt(15), endsAt: tomorrowAt(16) });
    await syncAppointment(a.id);
    expect(calls.some((x) => x.method === "PATCH" && x.url.includes(row.googleEventId!))).toBe(true);
    await updateAppointment(ctx.admin, a.id, { status: "canceled" });
    await syncAppointment(a.id);
    expect(calls.filter((x) => x.method === "PATCH").at(-1)!.body).toContain("cancelled");
    [row] = await db.select().from(appointments).where(eq(appointments.id, a.id));
    expect(row.calendarSyncedAt).toBeInstanceOf(Date);
  });

  it("horários ocupados juntam CRM e Google; seller só consulta closer", async () => {
    const { ctx, users: u } = await setupOrg();
    const c = await createContact(ctx.admin, { name: "Ana" });
    await createAppointment(ctx.admin, { contactId: c.id, ownerId: u.closer.id, title: "Call Ana", startsAt: tomorrowAt(9), endsAt: tomorrowAt(10), timezone: "America/Bahia" });
    const date = tomorrowAt(12).toISOString().slice(0, 10);
    const r1 = await busyTimes(ctx.seller, { ownerId: u.closer.id, date });
    expect(r1).toMatchObject({ google: "not_connected", ownerName: "Carla" });
    expect(r1.busy).toHaveLength(1);
    await expect(busyTimes(ctx.seller, { ownerId: u.seller2.id, date })).rejects.toMatchObject({ code: "forbidden" });

    await saveGoogleClient(ctx.admin, { clientId: "123456-abc.apps.googleusercontent.com", clientSecret: "segredo-google" });
    await db
      .insert(calendarConnections)
      .values({ userId: u.closer.id, orgId: ctx.closer.orgId, feedTokenHash: "h", feedTokenEnc: encryptSecret("t"), googleRefreshEnc: encryptSecret("RT"), googleEmail: "carla@x.com" })
      .onConflictDoUpdate({ target: calendarConnections.userId, set: { googleRefreshEnc: encryptSecret("RT") } });
    mockGoogle((u2) => (u2.includes("token") ? { body: { access_token: "AT" } } : { body: { calendars: { primary: { busy: [{ start: tomorrowAt(14).toISOString(), end: tomorrowAt(15).toISOString() }] } } } }));
    const r2 = await busyTimes(ctx.seller, { ownerId: u.closer.id, date });
    expect(r2.google).toBe("connected");
    expect(r2.busy.map((b) => b.source)).toEqual(["crm", "google"]);
    await loadInstanceSettings(true);
  });
});
