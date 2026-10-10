import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import {
  auditEvents,
  contactTags,
  contactTouchpoints,
  contacts,
  customFields,
  leadForms,
  leads,
  notifications,
  opportunities,
  pipelineStages,
  quizAnswers,
  quizConsents,
  quizFormVersions,
  quizQuestions,
  quizScoreHistory,
  quizSubmissions,
  relationshipEntries,
  tags,
} from "@/server/db/schema";
import { archiveForm, createForm, deleteForm, duplicateForm, getForm, listForms, publishForm, saveDraft, unpublishForm, formsDashboard } from "@/server/services/quizzes";
import { getPublicQuiz, recordEvent, submitQuiz } from "@/server/services/quizPublic";
import { anonymizeContactSubmissions, contactSubmissions, exportResponses, formAnalytics, getSubmission, listResponses, recalculate } from "@/server/services/quizReports";
import { listIntegrations } from "@/server/services/integrations";
import { getPublicForm } from "@/server/services/leads";
import { classify, computeScore, maxPoints, validateAnswers } from "@/lib/quiz/engine";
import { axionDefinition } from "@/lib/quiz/templates";
import type { Answers, QuizDefinition } from "@/lib/quiz/types";
import { setupOrg } from "./helpers";

const refs = { relationship: () => null };
const AX = axionDefinition(refs);

const IDENT = { nome: "Ana Souza", email: "ana@exemplo.com", whatsapp: "(71) 99999-1111", instagram: "https://instagram.com/AnaSouza", empresa: "Ana Cursos" };
/** Todas as melhores alternativas: 100 pontos. */
const HOT: Answers = { faturamento: "fat_100k_mais", margem: "mg_15_30", tempo_operacao: "tp_2a_mais", desafio: "ds_escalar", estrutura: "es_completa", resultado_90d: "rs_escalar", investimento: "iv_35k_mais", prazo: "pz_imediato" };
const COLD: Answers = { faturamento: "fat_ate_5k", margem: "mg_nao_sei", tempo_operacao: "tp_menos_3m", desafio: "ds_nao_sei", estrutura: "es_nenhuma", resultado_90d: "rs_sem_meta", investimento: "iv_ate_2k", prazo: "pz_pesquisando" };

const meta = { ip: "10.0.0.1", userAgent: "vitest" };
const body = (answers: Answers, extra: Record<string, unknown> = {}) => ({ sessionId: randomUUID(), answers, consent: { notice: true, marketing: true }, startedAt: Date.now() - 60_000, utm: { utm_source: "instagram", utm_campaign: "outubro" }, ...extra });

async function publishedAxion() {
  const env = await setupOrg();
  const form = await createForm(env.ctx.admin, { name: "Diagnóstico AXION", template: "axion-diagnostico" });
  await publishForm(env.ctx.admin, form.id);
  return { ...env, form: await getForm(env.ctx.admin, form.id) };
}

describe("motor do Lead Score", () => {
  it("modelo AXION soma 100 pontos e classifica pelas faixas", () => {
    expect(maxPoints(AX)).toBe(100);
    const hot = computeScore(AX, HOT);
    expect(hot).toMatchObject({ raw: 100, max: 100, score: 100 });
    expect(classify(AX.scoring, hot.score, HOT).tierId).toBe("icp_a");
    const cold = computeScore(AX, COLD);
    expect(cold.score).toBe(2); // "Não sei calcular" vale 2
    expect(classify(AX.scoring, cold.score, COLD).tierId).toBe("icp_d");
  });

  it("travas: score alto sem os requisitos não vira ICP A", () => {
    // 100 - 7 (investimento 10–20 mil) = 93 pontos, mas investimento < R$ 20 mil → ICP B
    const a1 = { ...HOT, investimento: "iv_10_20k" };
    const s1 = computeScore(AX, a1).score;
    expect(s1).toBe(93);
    const c1 = classify(AX.scoring, s1, a1);
    expect(c1.scoreTierId).toBe("icp_a");
    expect(c1.tierId).toBe("icp_b");
    expect(c1.path[0].failed).toEqual(["Investimento declarado de R$ 20 mil ou mais"]);

    // Investimento < R$ 10 mil: falha em A e em B → ICP C
    const a2 = { ...HOT, investimento: "iv_2_10k" };
    const c2 = classify(AX.scoring, computeScore(AX, a2).score, a2);
    expect(c2.tierId).toBe("icp_c");

    // Faturamento abaixo de R$ 20 mil derruba o A mesmo com o resto perfeito
    const a3 = { ...HOT, faturamento: "fat_5_20k" };
    expect(classify(AX.scoring, computeScore(AX, a3).score, a3).tierId).toBe("icp_b");

    // Pontuação de B, mas sem operação → C (não sobe nem pula para D)
    const a4 = { ...HOT, estrutura: "es_nenhuma", margem: "mg_nao_sei", desafio: "ds_conversao" }; // 79 pontos
    const s4 = computeScore(AX, a4).score;
    expect(s4).toBeGreaterThanOrEqual(60);
    expect(s4).toBeLessThan(80);
    expect(classify(AX.scoring, s4, a4).tierId).toBe("icp_c");
  });

  it("normaliza para 0–100 quando os pesos mudam", () => {
    const def: QuizDefinition = structuredClone(AX);
    const fat = def.sections[1].questions.find((q) => q.id === "faturamento")!;
    fat.options![0].points = 40; // máximo passa a 120
    expect(maxPoints(def)).toBe(120);
    expect(computeScore(def, HOT).score).toBe(100);
    expect(computeScore(def, { ...HOT, faturamento: "fat_ate_5k" }).score).toBe(67); // 80/120
    def.scoring.normalize = false;
    expect(computeScore(def, HOT).score).toBe(120);
  });

  it("valida respostas, máscara de telefone, Instagram e condições", () => {
    const { answers, errors } = validateAnswers(AX, { ...IDENT, email: "ana@", whatsapp: "123", instagram: "@ana.souza", ...HOT, faturamento: "inventada" });
    expect(errors.email).toMatch(/e-mail/);
    expect(errors.whatsapp).toMatch(/DDD/);
    expect(errors.faturamento).toBeTruthy();
    expect(answers.instagram).toBe("@ana.souza");
    const def: QuizDefinition = structuredClone(AX);
    def.sections[1].questions.find((q) => q.id === "margem")!.showIf = { mode: "all", conditions: [{ questionId: "faturamento", op: "not_equals", value: "fat_ate_5k" }] };
    // Pergunta oculta: não é obrigatória e não pontua.
    const r = validateAnswers(def, { ...IDENT, ...COLD, margem: undefined });
    expect(r.errors.margem).toBeUndefined();
    expect(computeScore(def, { ...COLD, margem: "mg_15_30" }).perQuestion.margem).toBe(0);
  });
});

describe("Formulários & Quizzes — fluxo completo", () => {
  it("publica o modelo AXION sem expor pontos e cria o lead no funil do ICP", async () => {
    const { ctx, users: u, form, org } = await publishedAxion();
    expect(form.status).toBe("published");
    expect(form.publicUrl).toMatch(/\/forms\/diagnostico-axion-[a-z0-9]{5}$/);
    expect(form.embed.iframe).toContain(`${form.publicUrl}?embed=1`);

    const pub = await getPublicQuiz(form.slug);
    expect(pub.status).toBe("ok");
    const json = JSON.stringify(pub);
    expect(json).not.toMatch(/"points"|"tiers"|"scoring"|"route"|"requirements"|notifyUserIds/);

    await recordEvent(form.slug, { sessionId: randomUUID(), kind: "view" }, "1.1.1.1");
    const res = await submitQuiz(form.slug, body({ ...IDENT, ...HOT }), meta);
    expect(res.message).toMatch(/Obrigado por compartilhar/);
    expect(JSON.stringify(res)).not.toMatch(/score|ICP/i);

    const [sub] = await db.select().from(quizSubmissions);
    expect(sub).toMatchObject({ score: 100, tierId: "icp_a", tierLabel: "ICP A — Lead quente", email: "ana@exemplo.com", phone: "+5571999991111", instagram: "anasouza", company: "Ana Cursos", channel: "link" });
    expect(sub.utm).toEqual({ utm_source: "instagram", utm_campaign: "outubro" });

    // ICP A → fila do closer (oportunidade no Kanban comercial dele), contato com etiquetas
    const [lead] = await db.select().from(leads).where(eq(leads.id, sub.leadId!));
    expect(lead.assignedTo).toBe(u.closer.id);
    const [opp] = await db.select().from(opportunities).where(eq(opportunities.contactId, sub.contactId!));
    expect(opp.closerId).toBe(u.closer.id);
    const tagNames = (await db.select({ name: tags.name }).from(contactTags).innerJoin(tags, eq(tags.id, contactTags.tagId)).where(eq(contactTags.contactId, sub.contactId!))).map((t) => t.name).sort();
    expect(tagNames).toEqual(["Diagnóstico AXION", "ICP A"]);
    // respostas e campos do CRM (ficha do closer)
    expect(await db.select().from(quizAnswers).where(eq(quizAnswers.submissionId, sub.id))).toHaveLength(13);
    const fields = await db.select().from(customFields).where(eq(customFields.orgId, org.id));
    const fat = fields.find((f) => f.key === "faturamento")!;
    expect(lead.custom[fat.id]).toBe("Acima de R$ 100 mil");
    expect(fields.find((f) => f.key === "empresa")).toBeTruthy();
    // consentimentos separados e versionados
    const consents = await db.select().from(quizConsents).where(eq(quizConsents.submissionId, sub.id));
    expect(consents.map((c) => [c.kind, c.granted, c.textVersion]).sort()).toEqual([
      ["marketing", true, "2026-10-v1"],
      ["processing_notice", true, "2026-10-v1"],
    ]);
    // aviso só para quem recebeu
    const closerNotes = await db.select().from(notifications).where(and(eq(notifications.userId, u.closer.id), eq(notifications.type, "lead.new")));
    expect(closerNotes).toHaveLength(1);
    // indicadores
    const a = await formAnalytics(ctx.admin, form.id, { duplicates: "hide" });
    expect(a).toMatchObject({ views: 1, completed: 1, avgScore: 100, qualified: 1 });
    expect(a.tiers.find((t) => t.id === "icp_a")!.count).toBe(1);
    expect(a.questions.find((q) => q.id === "faturamento")!.options[0].count).toBe(1);
    const d = await formsDashboard(ctx.admin, { days: 30 });
    expect(d.totals).toMatchObject({ forms: 1, published: 1, responses: 1, qualified: 1 });
  });

  it("ICP B vai para avaliação no Social Seller e ICP D fica só na base, sem aviso", async () => {
    const { users: u, form } = await publishedAxion();
    await submitQuiz(form.slug, body({ ...IDENT, ...HOT, investimento: "iv_10_20k" }), meta);
    await submitQuiz(form.slug, body({ ...IDENT, nome: "Davi", email: "davi@x.com", whatsapp: "(11) 98888-7777", instagram: "@davi", ...COLD }), meta);
    const subs = await db.select().from(quizSubmissions).orderBy(quizSubmissions.completedAt);
    expect(subs.map((s) => s.tierId)).toEqual(["icp_b", "icp_d"]);

    const [b] = await db.select().from(relationshipEntries).where(eq(relationshipEntries.contactId, subs[0].contactId!));
    const [stage] = await db.select().from(pipelineStages).where(eq(pipelineStages.id, b.stageId));
    expect(stage.key).toBe("em-qualificacao");
    const [leadB] = await db.select().from(leads).where(eq(leads.id, subs[0].leadId!));
    expect([u.seller.id, u.seller2.id]).toContain(leadB.assignedTo);

    const [leadD] = await db.select().from(leads).where(eq(leads.id, subs[1].leadId!));
    expect(leadD.assignedTo).toBeNull();
    expect(await db.select().from(relationshipEntries).where(eq(relationshipEntries.contactId, subs[1].contactId!))).toHaveLength(0);
    const unassigned = await db.select().from(notifications).where(eq(notifications.type, "lead.unassigned"));
    expect(unassigned).toHaveLength(0);
  });

  it("atualiza o contato existente (telefone/e-mail normalizados) e preserva o histórico", async () => {
    const { form, org } = await publishedAxion();
    const [existing] = await db.insert(contacts).values({ orgId: org.id, name: "Ana (Direct)", phone: "+55 71 99999-1111", username: "anasouza" }).returning();
    await submitQuiz(form.slug, body({ ...IDENT, ...HOT }), meta);
    const all = await db.select().from(contacts);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: existing.id, name: "Ana (Direct)", email: "ana@exemplo.com" });
    const tps = await db.select().from(contactTouchpoints).where(eq(contactTouchpoints.contactId, existing.id));
    expect(tps[0].note).toMatch(/Respondeu “Diagnóstico Estratégico — AXION”/);
  });

  it("protege contra envios duplicados, robôs e score manipulado", async () => {
    const { form } = await publishedAxion();
    const b = body({ ...IDENT, ...COLD }, { score: 100, tierId: "icp_a" });
    await submitQuiz(form.slug, b, meta);
    await submitQuiz(form.slug, b, meta); // mesmo envio (clique duplo)
    expect(await db.select().from(quizSubmissions)).toHaveLength(1);
    const [s] = await db.select().from(quizSubmissions);
    expect(s.tierId).toBe("icp_d"); // valores do navegador ignorados

    // Mesma pessoa de novo em poucos minutos: guardado como repetido, sem novo lead
    await submitQuiz(form.slug, body({ ...IDENT, ...HOT }), meta);
    const subs = await db.select().from(quizSubmissions).orderBy(quizSubmissions.completedAt);
    expect(subs).toHaveLength(2);
    expect(subs[1].duplicateOf).toBe(subs[0].id);
    expect(await db.select().from(leads)).toHaveLength(1);

    // Robô (campo invisível) e envio rápido demais: nada é gravado
    await submitQuiz(form.slug, body({ ...IDENT, email: "bot@x.com", whatsapp: "11911112222", ...HOT }, { website: "spam" }), meta);
    await submitQuiz(form.slug, body({ ...IDENT, email: "bot2@x.com", whatsapp: "11911113333", ...HOT }, { startedAt: Date.now() }), meta);
    expect(await db.select().from(quizSubmissions)).toHaveLength(2);

    // Sem o aviso de privacidade ou com alternativa inexistente: recusado
    await expect(submitQuiz(form.slug, body({ ...IDENT, ...HOT }, { consent: { notice: false } }), meta)).rejects.toMatchObject({ code: "invalid" });
    await expect(submitQuiz(form.slug, body({ ...IDENT, ...HOT, faturamento: "fat_999" }), meta)).rejects.toMatchObject({ code: "invalid" });
  });

  it("limita envios por aparelho", async () => {
    const { form } = await publishedAxion();
    for (let i = 0; i < 12; i++) await submitQuiz(form.slug, body({ ...IDENT, email: `p${i}@x.com`, whatsapp: `1198888${String(1000 + i)}`, instagram: `@p${i}`, ...COLD }), { ip: "9.9.9.9", userAgent: null });
    await expect(submitQuiz(form.slug, body({ ...IDENT, email: "z@x.com", whatsapp: "11977776666", instagram: "@z", ...COLD }), { ip: "9.9.9.9", userAgent: null })).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("versões: mudanças publicadas não alteram respostas antigas; recálculo é explícito e fica no histórico", async () => {
    const { ctx, form } = await publishedAxion();
    await submitQuiz(form.slug, body({ ...IDENT, ...HOT }), meta);
    const [before] = await db.select().from(quizSubmissions);

    const def = structuredClone(form.draft);
    const fat = def.sections[1].questions.find((q) => q.id === "faturamento")!;
    fat.title = "Faturamento médio mensal (últimos 3 meses)";
    fat.options![0].points = 0; // "Acima de R$ 100 mil" passa a valer 0
    await saveDraft(ctx.admin, form.id, { draft: def });
    const v2 = await publishForm(ctx.admin, form.id);
    expect(v2.publishedVersion).toBe(2);
    expect(v2.versions.map((v) => v.version)).toEqual([2, 1]);

    const [still] = await db.select().from(quizSubmissions);
    expect(still).toMatchObject({ score: 100, tierId: "icp_a", versionId: before.versionId });
    const detail = await getSubmission(ctx.admin, before.id);
    expect(detail.version).toBe(1);
    expect(detail.sections[1].answers[0].title).toBe("Qual é o seu faturamento médio mensal com infoprodutos nos últimos 3 meses?");
    // tabelas da versão 1 continuam intactas e não podem ser alteradas
    const v1q = await db.select().from(quizQuestions).where(and(eq(quizQuestions.versionId, before.versionId), eq(quizQuestions.key, "faturamento")));
    expect(v1q[0].title).toMatch(/infoprodutos/);
    await expect(db.update(quizFormVersions).set({ maxPoints: 1 }).where(eq(quizFormVersions.id, before.versionId))).rejects.toThrow();

    const r = await recalculate(ctx.admin, form.id, {});
    expect(r).toMatchObject({ version: 2, recalculated: 1, changed: 1 });
    const [after] = await db.select().from(quizSubmissions);
    expect(after.score).toBe(82); // 80 de 97 possíveis (o máximo de faturamento passou a 17), normalizado
    const hist = await db.select().from(quizScoreHistory).where(eq(quizScoreHistory.submissionId, before.id)).orderBy(quizScoreHistory.createdAt);
    expect(hist.map((h) => h.score)).toEqual([100, after.score]);
    expect(hist[1].reason).toMatch(/versão 2/);
    const audits = await db.select().from(auditEvents).where(eq(auditEvents.entityId, form.id));
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["form.created", "form.published", "form.scoring_published", "form.scoring_draft_changed", "form.recalculated"]));
  });

  it("despublicar deixa o link indisponível; arquivar, duplicar e excluir respeitam o histórico", async () => {
    const { ctx, form } = await publishedAxion();
    await unpublishForm(ctx.admin, form.id);
    expect(await getPublicQuiz(form.slug)).toMatchObject({ status: "unavailable", reason: "unpublished" });
    await expect(submitQuiz(form.slug, body({ ...IDENT, ...HOT }), meta)).rejects.toMatchObject({ code: "not_found" });
    expect(await getPublicQuiz("nao-existe")).toMatchObject({ status: "unavailable", reason: "not_found" });

    await publishForm(ctx.admin, form.id);
    await submitQuiz(form.slug, body({ ...IDENT, ...HOT }), meta);
    await expect(deleteForm(ctx.admin, form.id)).rejects.toMatchObject({ code: "conflict" });
    await archiveForm(ctx.admin, form.id, true);
    expect(await getPublicQuiz(form.slug)).toMatchObject({ status: "unavailable", reason: "archived" });

    const copy = await duplicateForm(ctx.admin, form.id);
    expect(copy).toMatchObject({ status: "draft", name: "Diagnóstico AXION (cópia)" });
    expect(copy.slug).not.toBe(form.slug);
    expect(copy.draft.sections[1].questions).toHaveLength(8);
    await deleteForm(ctx.admin, copy.id);
    expect((await listForms(ctx.admin, { status: "all" })).map((f) => f.id)).toEqual([form.id]);
  });

  it("formulário em branco: editar, reordenar e publicar; endereço personalizado único", async () => {
    const { ctx } = await setupOrg();
    const f = await createForm(ctx.manager, { name: "Aplicação Mentoria", template: "blank" });
    const def = structuredClone(f.draft);
    def.sections[0].questions.reverse();
    def.sections[0].questions.push({ id: "nota", type: "scale", title: "De 0 a 10, quanto você precisa de ajuda?", required: true, scored: true, crmField: "none", scale: { min: 0, max: 10, pointsPerStep: 1 } });
    def.appearance = { ...def.appearance, primary: "#123456", preset: "custom" };
    await saveDraft(ctx.manager, f.id, { draft: def, slug: "aplicacao-mentoria", name: "Mentoria — interno" });
    const g = await getForm(ctx.manager, f.id);
    expect(g.draft.sections[0].questions.map((q) => q.id)).toEqual(["whatsapp", "email", "nome", "nota"]);
    expect(g).toMatchObject({ slug: "aplicacao-mentoria", name: "Mentoria — interno", hasUnpublishedChanges: true });
    await publishForm(ctx.manager, f.id);
    expect((await getForm(ctx.manager, f.id)).hasUnpublishedChanges).toBe(false);
    const other = await createForm(ctx.manager, { name: "Outro", template: "blank" });
    await expect(saveDraft(ctx.manager, other.id, { slug: "aplicacao-mentoria" })).rejects.toMatchObject({ code: "conflict" });
    await expect(saveDraft(ctx.manager, other.id, { draft: { ...def, appearance: { ...def.appearance, primary: "vermelho" } } })).rejects.toMatchObject({ code: "invalid" });
    // edição concorrente não sobrescreve
    await expect(saveDraft(ctx.manager, f.id, { draft: def, baseUpdatedAt: new Date(0).toISOString() })).rejects.toMatchObject({ code: "conflict" });
  });

  it("permissões: só admin/gestor configuram; social seller vê respostas só dos próprios contatos", async () => {
    const { ctx, users: u, form } = await publishedAxion();
    await expect(listForms(ctx.seller, { status: "active" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(createForm(ctx.closer, { name: "x", template: "blank" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(listResponses(ctx.seller, form.id, { duplicates: "hide" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(exportResponses(ctx.closer, form.id, { duplicates: "hide" }, "csv")).rejects.toMatchObject({ code: "forbidden" });

    await submitQuiz(form.slug, body({ ...IDENT, ...HOT, investimento: "iv_10_20k" }), meta); // ICP B → social seller
    const [s] = await db.select().from(quizSubmissions);
    const [lead] = await db.select().from(leads).where(eq(leads.id, s.leadId!));
    const owner = lead.assignedTo === u.seller.id ? ctx.seller : ctx.seller2;
    const other = lead.assignedTo === u.seller.id ? ctx.seller2 : ctx.seller;
    expect(await contactSubmissions(owner, s.contactId!)).toHaveLength(1);
    expect((await getSubmission(owner, s.id)).tierLabel).toBe("ICP B — Lead qualificado");
    await expect(contactSubmissions(other, s.contactId!)).rejects.toMatchObject({ code: "not_found" });
    await expect(getSubmission(other, s.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(anonymizeContactSubmissions(ctx.manager, s.contactId!)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("filtra, exporta CSV/XLSX e anonimiza a pedido do titular", async () => {
    const { ctx, form } = await publishedAxion();
    await submitQuiz(form.slug, body({ ...IDENT, ...HOT }), meta);
    await submitQuiz(form.slug, body({ ...IDENT, nome: "Davi", email: "davi@x.com", whatsapp: "(11) 98888-7777", instagram: "@davi", ...COLD }, { embed: true, utm: {} }), meta);
    expect((await listResponses(ctx.admin, form.id, { duplicates: "hide", tier: "icp_d" })).rows.map((r) => r.name)).toEqual(["Davi"]);
    expect((await listResponses(ctx.admin, form.id, { duplicates: "hide", scoreMin: 50 })).rows.map((r) => r.name)).toEqual(["Ana Souza"]);
    expect((await listResponses(ctx.admin, form.id, { duplicates: "hide", origin: "Site (incorporado)" })).total).toBe(1);
    expect((await listResponses(ctx.admin, form.id, { duplicates: "hide", status: "new" })).total).toBe(2);

    const csv = await exportResponses(ctx.admin, form.id, { duplicates: "hide" }, "csv");
    const text = csv.body.toString("utf8");
    expect(text.split("\r\n")[0]).toContain("Classificação");
    expect(text).toContain("ICP A — Lead quente");
    expect(text).toContain("Acima de R$ 100 mil");
    const xlsx = await exportResponses(ctx.admin, form.id, { duplicates: "hide" }, "xlsx");
    expect(xlsx.body.subarray(0, 2).toString()).toBe("PK");
    expect(xlsx.filename).toMatch(/\.xlsx$/);

    const [ana] = await db.select().from(quizSubmissions).where(eq(quizSubmissions.name, "Ana Souza"));
    await anonymizeContactSubmissions(ctx.admin, ana.contactId!);
    const [anon] = await db.select().from(quizSubmissions).where(eq(quizSubmissions.id, ana.id));
    expect(anon).toMatchObject({ name: "Titular anonimizado", email: null, phone: null });
    expect(anon.score).toBe(100);
  });

  it("formulários ficam fora da Central de Integrações e do endereço antigo /f", async () => {
    const { ctx, form } = await publishedAxion();
    expect(await listIntegrations(ctx.admin)).toHaveLength(0);
    const [backing] = await db.select().from(leadForms);
    expect(backing.provider).toBe("crmlabs_quiz");
    expect(await getPublicForm(backing.slug)).toBeNull();
    expect(form.id).toBeTruthy();
  });
});
