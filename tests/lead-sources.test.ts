import { describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { leadSources, leads } from "@/server/db/schema";
import { leadSourceStats, listLeads, submitPublicForm } from "@/server/services/leads";
import { createForm } from "@/server/services/integrations";
import { setupOrg } from "./helpers";

const base = { consent: true as const, startedAt: Date.now() - 10_000 };
const daysAgo = (d: number) => new Date(Date.now() - d * 86400000);

async function seed() {
  const { org, ctx } = await setupOrg();
  const form = await createForm(ctx.admin, { name: "Anúncio", headline: "Quero saber mais", questions: [] });
  const names = ["Ana", "Bia", "Caio", "Davi", "Eva", "Fabi"];
  for (const [i, name] of names.entries()) await submitPublicForm(form.slug, { ...base, name, phone: `7199999000${i}` }, `9.9.9.${i}`);
  const all = await db.select().from(leads).where(eq(leads.orgId, org.id)).orderBy(leads.name);
  const srcs = await db.select().from(leadSources).where(eq(leadSources.orgId, org.id)).orderBy(leadSources.position);
  const [insta, whats] = srcs;
  // Ana, Bia, Caio: fonte 1 nos últimos 7 dias · Davi: fonte 2 há 3 dias · Eva: sem origem há 2 dias · Fabi: fonte 1 há 20 dias
  const set = async (name: string, sourceId: string | null, createdAt: Date) =>
    db
      .update(leads)
      .set({ sourceId, createdAt })
      .where(eq(leads.id, all.find((l) => l.name === name)!.id));
  await set("Ana", insta.id, daysAgo(1));
  await set("Bia", insta.id, daysAgo(2));
  await set("Caio", insta.id, daysAgo(0));
  await set("Davi", whats.id, daysAgo(3));
  await set("Eva", null, daysAgo(2));
  await set("Fabi", insta.id, daysAgo(10));
  return { ctx, insta, whats, all };
}

describe("leads por fonte de tráfego", () => {
  it("conta por origem no período, compara com o anterior e monta a evolução", async () => {
    const { ctx, insta, whats } = await seed();
    const s = await leadSourceStats(ctx.admin, { periodo: "7d" });
    expect(s.total).toBe(5);
    expect(s.previousTotal).toBe(1);
    expect(s.sources.map((x) => [x.id, x.n, x.previous])).toEqual([
      [insta.id, 3, 1],
      ["none", 1, 0],
      [whats.id, 1, 0],
    ]);
    expect(s.sources.find((x) => x.id === "none")).toMatchObject({ name: "Sem origem", color: "gray" });
    expect(s.unit).toBe("day");
    expect(s.series).toHaveLength(7);
    expect(s.series.reduce((a, p) => a + p.total, 0)).toBe(5);
    expect(s.series.reduce((a, p) => a + (p.bySource[insta.id] ?? 0), 0)).toBe(3);

    const all = await leadSourceStats(ctx.admin, { periodo: "all" });
    expect(all.total).toBe(6);
    expect(all.previousTotal).toBeNull();
    expect(all.series.reduce((a, p) => a + p.total, 0)).toBe(6);

    const quarter = await leadSourceStats(ctx.admin, { periodo: "90d" });
    expect(quarter.unit).toBe("week");
    expect(quarter.series.reduce((a, p) => a + p.total, 0)).toBe(6);
  });

  it("filtra a lista por fonte e período", async () => {
    const { ctx, insta } = await seed();
    const byName = (r: { rows: { name: string }[] }) => r.rows.map((x) => x.name).sort();
    expect(byName(await listLeads(ctx.admin, { status: "all", page: 1, fonte: insta.id }))).toEqual(["Ana", "Bia", "Caio", "Fabi"]);
    expect(byName(await listLeads(ctx.admin, { status: "all", page: 1, fonte: insta.id, periodo: "7d" }))).toEqual(["Ana", "Bia", "Caio"]);
    expect(byName(await listLeads(ctx.admin, { status: "all", page: 1, fonte: "none" }))).toEqual(["Eva"]);
    expect((await listLeads(ctx.admin, { status: "all", page: 1, periodo: "30d" })).total).toBe(6);
  });

  it("vendedor só vê na conta os leads que ele pode ver", async () => {
    const { ctx, all } = await seed();
    // Leads da fila (sem responsável) são de todos os SDRs; os já assumidos por outro seller somem da conta.
    const taken = all.slice(0, 2);
    await db.update(leads).set({ assignedTo: ctx.seller2.userId }).where(inArray(leads.id, taken.map((l) => l.id)));
    const s = await leadSourceStats(ctx.seller, { periodo: "30d" });
    expect(s.total).toBe(all.length - taken.length);
    const s2 = await leadSourceStats(ctx.seller2, { periodo: "30d" });
    expect(s2.total).toBe(all.length);
  });
});
