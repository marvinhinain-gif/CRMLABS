import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { contactTouchpoints, contacts, leads, opportunities } from "@/server/db/schema";
import { catalog, createCustomField, createIntegration, createProduct, listIntegrations, listLogs, originMetrics, receiveWebhook, setSigningSecret, testIntegration, updateIntegration } from "@/server/services/integrations";
import { getLead } from "@/server/services/leads";
import { addTouchpoint, contactJourney } from "@/server/services/journey";
import { getAgendaItem } from "@/server/services/commercial";
import { decideOpportunity } from "@/server/services/commercial";
import { setupOrg } from "./helpers";

const json = (b: unknown, extra: Record<string, string> = {}) => ({ raw: JSON.stringify(b), headers: new Headers({ "content-type": "application/json", ...extra }) });
const tokenOf = (url: string) => url.split("/").pop()!;

async function setup() {
  const o = await setupOrg();
  const cat = await catalog(o.ctx.admin);
  const src = (k: string) => cat.sources.find((s) => s.key === k)!.id;
  const field = (k: string) => cat.customFields.find((f) => f.key === k)!.id;
  return { ...o, cat, src, field };
}

describe("integrações de captação", () => {
  it("somente administradores configuram (checado no servidor)", async () => {
    const { ctx, src } = await setup();
    for (const who of [ctx.manager, ctx.seller, ctx.closer]) {
      await expect(listIntegrations(who)).rejects.toMatchObject({ code: "forbidden" });
      await expect(createIntegration(who, { provider: "webhook", name: "X", sourceId: src("stories") })).rejects.toMatchObject({ code: "forbidden" });
      await expect(createProduct(who, "Consultoria")).rejects.toMatchObject({ code: "forbidden" });
    }
    // catálogo (só nomes) é visível para a equipe
    expect((await catalog(ctx.seller)).sources.map((s) => s.name)).toContain("Stories");
  });

  it("Typeform com assinatura, mapeamento para campos personalizados e origem definida pela integração", async () => {
    const { ctx, src, field, users: u } = await setup();
    const prod = await createProduct(ctx.admin, "Consultoria");
    const integ = await createIntegration(ctx.admin, {
      provider: "typeform",
      name: "Quiz Consultoria — Stories",
      sourceId: src("stories"),
      campaign: "Stories Lucão",
      productId: prod.id,
      assigneeIds: [u.seller.id],
      fieldMap: [
        { key: "Quanto você fatura atualmente?", target: `custom:${field("faturamento")}` },
        { key: "Principal dificuldade", target: `custom:${field("dor_principal")}` },
      ],
    });
    const secret = "segredo-do-typeform-123";
    await setSigningSecret(ctx.admin, integ.id, secret);
    const body = {
      event_type: "form_response",
      form_response: {
        definition: { fields: [{ id: "a", title: "Nome completo" }, { id: "b", title: "WhatsApp" }, { id: "c", title: "Quanto você fatura atualmente?" }, { id: "d", title: "Principal dificuldade" }, { id: "e", title: "Seu Instagram" }] },
        answers: [
          { field: { id: "a" }, type: "text", text: "Maria Silva" },
          { field: { id: "b" }, type: "phone_number", phone_number: "+5571988887777" },
          { field: { id: "c" }, type: "choice", choice: { label: "R$30.000 a R$50.000" } },
          { field: { id: "d" }, type: "text", text: "Escalar campanhas mantendo margem." },
          { field: { id: "e" }, type: "text", text: "@mariasilva" },
        ],
        hidden: { utm_source: "instagram", utm_campaign: "outubro" },
      },
    };
    const { raw } = json(body);
    // sem assinatura: recusado e registrado no log
    await expect(receiveWebhook(tokenOf(integ.webhookUrl!), raw, json(body).headers)).rejects.toMatchObject({ code: "forbidden" });
    expect((await listIntegrations(ctx.admin))[0].status).toBe("error");
    const sig = `sha256=${createHmac("sha256", secret).update(raw).digest("base64")}`;
    const r = await receiveWebhook(tokenOf(integ.webhookUrl!), raw, json(body, { "typeform-signature": sig }).headers);
    const lead = await getLead(ctx.seller, r.leadId);
    expect(lead).toMatchObject({ name: "Maria Silva", phone: "+5571988887777", instagram: "mariasilva", channel: "typeform", campaign: "Stories Lucão", source: { name: "Stories" }, productName: "Consultoria", assignedTo: u.seller.id });
    expect(lead.customValues).toEqual([
      { label: "Faturamento", value: "R$30.000 a R$50.000" },
      { label: "Dor principal", value: "Escalar campanhas mantendo margem." },
    ]);
    expect(lead.utm).toEqual({ utm_source: "instagram", utm_campaign: "outubro" });
    expect(lead.journey?.first?.name).toBe("Stories");
    expect((await listIntegrations(ctx.admin))[0].status).toBe("active");
    const logs = await listLogs(ctx.admin, integ.id);
    expect(logs.map((l) => l.result)).toEqual(expect.arrayContaining(["success", "error"]));
    // segredo nunca aparece na resposta de administrador
    expect(JSON.stringify(await listIntegrations(ctx.admin))).not.toContain(secret);
  });

  it("Tally, closer em responsável fixo e destino no funil Comercial", async () => {
    const { ctx, src, users: u } = await setup();
    const integ = await createIntegration(ctx.admin, { provider: "tally", name: "Aplicação Mentoria — Tráfego", sourceId: src("trafego-pago"), pipelineKind: "sales", assignMode: "fixed", fixedAssigneeId: u.closer.id });
    const body = {
      eventType: "FORM_RESPONSE",
      data: {
        fields: [
          { key: "q1", label: "Nome", type: "INPUT_TEXT", value: "João Lima" },
          { key: "q2", label: "E-mail", type: "INPUT_EMAIL", value: "joao@x.com" },
          { key: "q3", label: "Objetivo", type: "MULTIPLE_CHOICE", value: ["o2"], options: [{ id: "o1", text: "Começar" }, { id: "o2", text: "Chegar a R$100 mil/mês" }] },
        ],
      },
    };
    const r = await receiveWebhook(tokenOf(integ.webhookUrl!), JSON.stringify(body), json(body).headers);
    const [l] = await db.select().from(leads).where(eq(leads.id, r.leadId));
    expect(l).toMatchObject({ assignedTo: u.closer.id, channel: "tally" });
    expect(l.answers).toEqual([{ label: "Objetivo", value: "Chegar a R$100 mil/mês" }]);
    const [o] = await db.select().from(opportunities).where(eq(opportunities.id, l.opportunityId!));
    expect(o).toMatchObject({ closerId: u.closer.id, status: "open" });
    // o closer vê o lead pela oportunidade
    expect((await getLead(ctx.closer, r.leadId)).name).toBe("João Lima");
  });

  it("não duplica: atualiza o contato, preserva a primeira origem e registra a jornada", async () => {
    const { ctx, src } = await setup();
    const organic = await createIntegration(ctx.admin, { provider: "webhook", name: "Bio — Orgânico", sourceId: src("conteudo-organico") });
    const paid = await createIntegration(ctx.admin, { provider: "webhook", name: "Quiz Consultoria — Tráfego", sourceId: src("trafego-pago"), campaign: "Diagnóstico Outubro" });
    const send = (integ: typeof organic, b: Record<string, string>) => receiveWebhook(tokenOf(integ.webhookUrl!), JSON.stringify(b), json(b).headers);
    const r1 = await send(organic, { nome: "Ana", whatsapp: "71 99999-1111" });
    const [c] = await db.select().from(contacts);
    await addTouchpoint(ctx.admin, c.id, { sourceId: src("stories"), note: "Voltou pelos Stories" });
    const r2 = await send(paid, { nome: "Ana Souza", telefone: "+55 (71) 99999-1111", email: "ana@x.com" });
    expect(await db.select().from(contacts)).toHaveLength(1);
    const j = await contactJourney(ctx.admin, c.id);
    expect(j?.first?.name).toBe("Conteúdo Orgânico");
    expect(j?.last?.name).toBe("Tráfego Pago");
    expect(j?.touchpoints.map((t) => t.source?.name)).toEqual(["Conteúdo Orgânico", "Stories", "Tráfego Pago"]);
    expect(j?.touchpoints[2].note).toMatch(/novamente/);
    const [updated] = await db.select().from(contacts);
    expect(updated.email).toBe("ana@x.com");
    expect(r1.leadId).not.toBe(r2.leadId);
    expect(await db.select().from(contactTouchpoints)).toHaveLength(3);
  });

  it("sem dado de contato: recusa, registra erro e o teste explica o que falta", async () => {
    const { ctx, src } = await setup();
    const integ = await createIntegration(ctx.admin, { provider: "webhook", name: "Quiz X", sourceId: src("evento"), fieldMap: [{ key: "Nome completo", target: "name" }] });
    const b = { "Nome completo": "Sem Contato", Cidade: "Salvador" };
    await expect(receiveWebhook(tokenOf(integ.webhookUrl!), JSON.stringify(b), json(b).headers)).rejects.toMatchObject({ code: "invalid" });
    const logs = await listLogs(ctx.admin, integ.id);
    expect(logs[0]).toMatchObject({ result: "error", message: expect.stringMatching(/telefone, e-mail ou Instagram/) });
    const t = await testIntegration(ctx.admin, integ.id);
    expect(t.ok).toBe(false);
    expect(t.problems).toEqual(expect.arrayContaining(["Telefone não foi identificado.", "O campo “Instagram” ainda não está mapeado."]));
    expect(t.receivedKeys).toEqual(["Nome completo", "Cidade"]);
    const t2 = await testIntegration(ctx.admin, integ.id, { "Nome completo": "Teste", whatsapp: "71988776655", insta: "@teste" });
    expect(t2).toMatchObject({ ok: true, message: "Lead recebido com sucesso.", detected: { nome: true, telefone: true, instagram: true, origem: true } });
    expect(await db.select().from(leads)).toHaveLength(0); // teste não cria lead
    await updateIntegration(ctx.admin, integ.id, { active: false });
    await expect(receiveWebhook(tokenOf(integ.webhookUrl!), "{}", json({}).headers)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("ficha do closer e resultados por origem", async () => {
    const { ctx, src, field, users: u } = await setup();
    const integ = await createIntegration(ctx.admin, { provider: "webhook", name: "Aplicação Consultoria", sourceId: src("collab"), partner: "@parceiro", pipelineKind: "sales", fixedAssigneeId: u.closer.id, assignMode: "fixed", fieldMap: [{ key: "objetivo", target: `custom:${field("objetivo")}` }] });
    const b = { nome: "Rita", whatsapp: "71977776666", objetivo: "Dobrar o faturamento" };
    const r = await receiveWebhook(tokenOf(integ.webhookUrl!), JSON.stringify(b), json(b).headers);
    const [l] = await db.select().from(leads).where(eq(leads.id, r.leadId));
    const { createAppointment } = await import("@/server/services/commercial");
    const a = await createAppointment(ctx.closer, { contactId: l.contactId, title: "Call", startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 90000000), timezone: "America/Bahia" });
    const sheet = await getAgendaItem(ctx.closer, a.id);
    expect(sheet.journey?.first?.name).toBe("Collab");
    expect(sheet.journey?.qualified).toEqual([expect.objectContaining({ label: "Objetivo", value: "Dobrar o faturamento" })]);
    await db.update(opportunities).set({ valueCents: 500000 }).where(eq(opportunities.id, l.opportunityId!));
    await decideOpportunity(ctx.closer, l.opportunityId!, { status: "won" });
    const m = await originMetrics(ctx.admin, { by: "source", days: 30 });
    expect(m.find((x) => x.label === "Collab")).toMatchObject({ leads: 1, calls: 1, sales: 1, revenueCents: 500000, avgTicketCents: 500000 });
    const byPartner = await originMetrics(ctx.admin, { by: "partner", days: 30 });
    expect(byPartner[0].label).toBe("@parceiro");
    await expect(originMetrics(ctx.manager, { by: "source", days: 30 })).rejects.toMatchObject({ code: "forbidden" });
    await createCustomField(ctx.admin, "Faturamento Atual");
    expect((await catalog(ctx.admin)).customFields.map((f) => f.label)).toContain("Faturamento Atual");
  });
});
