import { describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db";
import { cadenceActivities, cadenceSteps, contacts, leads, relationshipEntries } from "@/server/db/schema";
import { forwardLeadToKanban, submitPublicForm } from "@/server/services/leads";
import { applyCadenceAction } from "@/server/services/cadence";
import { createForm } from "@/server/services/integrations";
import { setupOrg } from "./helpers";

const base = { consent: true as const, startedAt: Date.now() - 10_000 };
let seq = 0;
async function newLead(o: Awaited<ReturnType<typeof setupOrg>>) {
  const form = await createForm(o.ctx.admin, { name: `Form ${++seq}`, headline: "Oi", questions: [] });
  await submitPublicForm(form.slug, { ...base, name: `Lead ${seq}`, phone: `7198${String(1000000 + seq)}` }, "1.1.1.1");
  return (await db.select().from(leads).where(eq(leads.formId, form.id)))[0];
}
const entryOf = async (contactId: string) => (await db.select().from(relationshipEntries).where(and(eq(relationshipEntries.contactId, contactId), isNull(relationshipEntries.closedAt))))[0];

describe("Encaminhar para o SDR entra na fase de ligação", () => {
  it("gestor encaminha: cadência começa em Ligação 1, para hoje, com próxima ação no contato", async () => {
    const o = await setupOrg();
    const l = await newLead(o);
    const before = Date.now();
    await forwardLeadToKanban(o.ctx.admin, l.id, { sdrId: o.users.seller.id });
    const e = await entryOf(l.contactId);
    const [step] = await db.select().from(cadenceSteps).where(eq(cadenceSteps.id, e.cadenceStepId!));
    expect(e.cadenceStatus).toBe("active");
    expect(step).toMatchObject({ key: "ligacao-1", channel: "call" });
    expect(e.cadenceDueAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    const [c] = await db.select().from(contacts).where(eq(contacts.id, l.contactId));
    expect(c.nextAction).toContain("Ligação 1");
    const acts = await db.select().from(cadenceActivities).where(eq(cadenceActivities.contactId, l.contactId));
    expect(acts.map((a) => a.outcome)).toEqual(["started"]);
  });

  it("não reinicia uma cadência que já está andando", async () => {
    const o = await setupOrg();
    const l = await newLead(o);
    await forwardLeadToKanban(o.ctx.admin, l.id, { sdrId: o.users.seller.id });
    const steps = await db.select().from(cadenceSteps).where(eq(cadenceSteps.orgId, o.org.id));
    const msg = steps.find((s) => s.key === "mensagem-2")!;
    await applyCadenceAction(o.ctx.admin, l.contactId, { action: "set_step", stepId: msg.id });
    await forwardLeadToKanban(o.ctx.admin, l.id, { sdrId: o.users.seller2.id });
    expect((await entryOf(l.contactId)).cadenceStepId).toBe(msg.id);
  });
});
