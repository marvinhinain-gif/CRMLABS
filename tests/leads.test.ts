import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { appointments, contacts, leadForms, leads, notifications, relationshipEntries } from "@/server/db/schema";
import { createForm, getLead, ingestWebhookLead, listForms, listLeads, normalizePhone, scheduleLead, submitPublicForm, updateForm, updateLead } from "@/server/services/leads";
import { listAppointments } from "@/server/services/commercial";
import { setupOrg } from "./helpers";

const future = (days: number, hour = 14) => {
  const d = new Date(Date.now() + days * 86400000);
  return `${d.toISOString().slice(0, 10)}T${String(hour).padStart(2, "0")}:00`;
};
const base = { consent: true as const, startedAt: Date.now() - 10_000 };
const notesOf = (userId: string) => db.select().from(notifications).where(eq(notifications.userId, userId));

async function formFor(ctx: Awaited<ReturnType<typeof setupOrg>>["ctx"], extra: Record<string, unknown> = {}) {
  return createForm(ctx.admin, {
    name: "Mentoria — Anúncio Outubro",
    headline: "Quero saber mais",
    questions: [
      { id: "faturamento", label: "Qual o seu faturamento mensal?", type: "choice", required: true, options: ["Até 10 mil", "10 a 50 mil", "Mais de 50 mil"] },
      { id: "desafio", label: "Seu maior desafio hoje", type: "textarea", required: false },
    ],
    ...extra,
  });
}

describe("leads de anúncio", () => {
  it("formulário público: cria contato, distribui em rodízio e avisa só o social seller", async () => {
    const { ctx, users: u } = await setupOrg();
    const form = await formFor(ctx);
    expect(form.publicUrl).toMatch(/\/f\/mentoria-anuncio-outubro$/);

    await submitPublicForm(form.slug, { ...base, name: "Ana Souza", phone: "(71) 99999-1111", email: "ANA@x.com", instagram: "@anasouza", preferredAt: future(2), answers: { faturamento: "10 a 50 mil", desafio: "Gerar leads" }, utm: { utm_source: "facebook", utm_campaign: "outubro" } }, "1.1.1.1");
    await submitPublicForm(form.slug, { ...base, name: "Bruno Costa", phone: "71988882222", answers: { faturamento: "Até 10 mil" } }, "1.1.1.2");

    const all = await db.select().from(leads).orderBy(leads.createdAt);
    expect(all).toHaveLength(2);
    expect(new Set(all.map((l) => l.assignedTo))).toEqual(new Set([u.seller.id, u.seller2.id])); // rodízio
    const ana = all[0];
    expect(ana).toMatchObject({ name: "Ana Souza", phone: "+5571999991111", email: "ana@x.com", instagram: "anasouza", status: "new", channel: "form" });
    expect(ana.answers).toEqual([
      { label: "Qual o seu faturamento mensal?", value: "10 a 50 mil" },
      { label: "Seu maior desafio hoje", value: "Gerar leads" },
    ]);
    expect(ana.utm).toEqual({ utm_source: "facebook", utm_campaign: "outubro" });
    expect(ana.preferredAt).toBeInstanceOf(Date);

    // contato criado com dono = social seller e cartão em "Novo interessado"
    const [c] = await db.select().from(contacts).where(eq(contacts.id, ana.contactId));
    expect(c).toMatchObject({ source: "lead_form", ownerId: ana.assignedTo });
    expect(await db.select().from(relationshipEntries).where(eq(relationshipEntries.contactId, c.id))).toHaveLength(1);

    // notificação apenas para quem recebeu
    const sellerNotes = (await notesOf(ana.assignedTo!)).filter((n) => n.type === "lead.new");
    expect(sellerNotes).toHaveLength(1);
    expect(sellerNotes[0].title).toBe("Novo lead: Ana Souza");
    expect(sellerNotes[0].link).toBe(`/leads?lead=${ana.id}`);
    for (const other of [u.admin, u.manager, u.closer]) expect((await notesOf(other.id)).some((n) => n.type === "lead.new")).toBe(false);
  });

  it("cliente que volta fica com o mesmo social seller e não duplica contato", async () => {
    const { ctx } = await setupOrg();
    const form = await formFor(ctx, { questions: [] });
    await submitPublicForm(form.slug, { ...base, name: "Ana", phone: "71999991111" }, "2.2.2.1");
    await submitPublicForm(form.slug, { ...base, name: "Ana S.", phone: "+55 (71) 99999-1111" }, "2.2.2.2");
    const all = await db.select().from(leads);
    expect(all).toHaveLength(2);
    expect(all[0].contactId).toBe(all[1].contactId);
    expect(all[0].assignedTo).toBe(all[1].assignedTo);
    expect(await db.select().from(contacts)).toHaveLength(1);
  });

  it("valida respostas obrigatórias, bloqueia robôs e limita envios por IP", async () => {
    const { ctx } = await setupOrg();
    const form = await formFor(ctx);
    await expect(submitPublicForm(form.slug, { ...base, name: "X Y", phone: "71999990000", answers: {} }, "3.3.3.3")).rejects.toMatchObject({ code: "invalid", details: { fields: { q_faturamento: expect.any(String) } } });
    await expect(submitPublicForm(form.slug, { ...base, name: "X Y", phone: "123", answers: { faturamento: "Até 10 mil" } }, "3.3.3.3")).rejects.toMatchObject({ code: "invalid" });
    await expect(submitPublicForm(form.slug, { name: "X Y", phone: "71999990000", answers: { faturamento: "Até 10 mil" } }, "3.3.3.3")).rejects.toBeTruthy(); // sem consentimento
    // robô (campo invisível preenchido): finge sucesso e não grava
    const r = await submitPublicForm(form.slug, { ...base, website: "http://spam", name: "Bot", phone: "71999990000", answers: { faturamento: "Até 10 mil" } }, "3.3.3.3");
    expect(r.ok).toBe(true);
    expect(await db.select().from(leads)).toHaveLength(0);
    for (let i = 0; i < 8; i++) await submitPublicForm(form.slug, { ...base, name: `Pessoa ${i}`, phone: `7199999${String(1000 + i)}`, answers: { faturamento: "Até 10 mil" } }, "9.9.9.9");
    await expect(submitPublicForm(form.slug, { ...base, name: "Mais um", phone: "71999998888", answers: { faturamento: "Até 10 mil" } }, "9.9.9.9")).rejects.toMatchObject({ code: "rate_limited" });
    // formulário desativado some
    await updateForm(ctx.admin, form.id, { active: false });
    await expect(submitPublicForm(form.slug, { ...base, name: "Z Z", phone: "71999997777", answers: { faturamento: "Até 10 mil" } }, "4.4.4.4")).rejects.toMatchObject({ code: "not_found" });
  });

  it("webhook aceita formatos comuns (Zapier, Make e Lead Ads da Meta)", async () => {
    const { ctx } = await setupOrg();
    const form = await formFor(ctx, { questions: [] });
    const token = (await listForms(ctx.admin))[0].webhookUrl!.split("/").pop()!;
    await ingestWebhookLead(token, { field_data: [{ name: "full_name", values: ["Carla Dias"] }, { name: "phone_number", values: ["+5571977776666"] }, { name: "email", values: ["carla@x.com"] }, { name: "qual_seu_objetivo?", values: ["Escalar"] }], ad_name: "Criativo 3", campaign_name: "Outubro" });
    await ingestWebhookLead(token, { nome: "Diego", whatsapp: "71 96666-5555", "Melhor horário": future(3, 10), Cidade: "Salvador", utm_source: "instagram" });
    const all = await db.select().from(leads).orderBy(leads.createdAt);
    expect(all[0]).toMatchObject({ name: "Carla Dias", phone: "+5571977776666", email: "carla@x.com", channel: "webhook", utm: { ad_name: "Criativo 3", campaign_name: "Outubro" } });
    expect(all[0].answers).toEqual([{ label: "qual_seu_objetivo?", value: "Escalar" }]);
    expect(all[1]).toMatchObject({ name: "Diego", phone: "+5571966665555", utm: { utm_source: "instagram" } });
    expect(all[1].preferredAt).toBeInstanceOf(Date);
    expect(all[1].answers).toEqual([{ label: "Cidade", value: "Salvador" }]);
    await expect(ingestWebhookLead("x".repeat(32), { nome: "Y" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("social seller confirma a reunião: agendamento criado, lead agendado, closer e admin avisados", async () => {
    const { ctx, users: u } = await setupOrg();
    const form = await formFor(ctx, { questions: [], assigneeIds: [u.seller.id] });
    await submitPublicForm(form.slug, { ...base, name: "Ana Souza", phone: "71999991111", preferredAt: future(2) }, "5.5.5.5");
    const [lead] = await db.select().from(leads);
    expect(lead.assignedTo).toBe(u.seller.id);

    // outro seller não vê o lead
    expect((await listLeads(ctx.seller2, { status: "all", page: 1 })).rows).toHaveLength(0);
    await expect(getLead(ctx.seller2, lead.id)).rejects.toMatchObject({ code: "not_found" });

    await updateLead(ctx.seller, lead.id, { status: "contacted" });
    const startsAt = lead.preferredAt!;
    const { appointment } = await scheduleLead(ctx.seller, lead.id, { startsAt, endsAt: new Date(startsAt.getTime() + 3600_000), ownerId: u.closer.id });
    const detail = await getLead(ctx.seller, lead.id);
    expect(detail.status).toBe("scheduled");
    expect(detail.appointment).toMatchObject({ id: appointment.id, status: "scheduled", ownerName: "Carla" });
    const [a] = await db.select().from(appointments).where(eq(appointments.id, appointment.id));
    expect(a).toMatchObject({ leadId: lead.id, ownerId: u.closer.id, title: "Reunião com Ana Souza" });
    expect((await notesOf(u.closer.id)).some((n) => n.type === "meeting.assigned")).toBe(true);
    expect((await notesOf(u.admin.id)).some((n) => n.type === "meeting.scheduled")).toBe(true);
    // closer vê a reunião em Agendamentos
    expect((await listAppointments(ctx.closer, { status: "all" })).map((x) => x.id)).toContain(appointment.id);
    // não agenda duas vezes
    await expect(scheduleLead(ctx.seller, lead.id, { startsAt, endsAt: new Date(startsAt.getTime() + 3600_000) })).rejects.toMatchObject({ code: "conflict" });
    // seller não marca reunião para outro seller
    await submitPublicForm(form.slug, { ...base, name: "Bruno", phone: "71999992222" }, "5.5.5.6");
    const [l2] = (await db.select().from(leads).where(and(eq(leads.name, "Bruno"))));
    await expect(scheduleLead(ctx.seller, l2.id, { startsAt, endsAt: new Date(startsAt.getTime() + 3600_000), ownerId: u.seller2.id })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("sem social seller ativo: administradores são avisados", async () => {
    const { ctx, users: u } = await setupOrg();
    const form = await formFor(ctx, { questions: [], assigneeIds: [u.seller.id] });
    const { memberships } = await import("@/server/db/schema");
    await db.update(memberships).set({ status: "disabled" }).where(eq(memberships.userId, u.seller.id));
    await submitPublicForm(form.slug, { ...base, name: "Sem Dono", phone: "71999993333" }, "6.6.6.6");
    const [lead] = await db.select().from(leads);
    expect(lead.assignedTo).toBeNull();
    expect((await notesOf(u.admin.id)).some((n) => n.type === "lead.unassigned")).toBe(true);
  });

  it("normaliza telefones brasileiros", () => {
    expect(normalizePhone("(71) 99999-1111")).toBe("+5571999991111");
    expect(normalizePhone("+55 71 99999 1111")).toBe("+5571999991111");
    expect(normalizePhone("0055 71 3333 4444")).toBe("+557133334444");
    expect(normalizePhone("123")).toBeNull();
  });
});
