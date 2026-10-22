import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { channelIdentities, connectedAccounts, contacts, contactTags, leadSources, leads, opportunities, pipelineStages, quizForms, quizScoreHistory, quizSubmissions, relationshipEntries, tags } from "@/server/db/schema";
import { createForm, createFormSource, getForm, publishForm, saveDraft, shareableForms } from "@/server/services/quizzes";
import { getPublicQuiz, recordEvent, scoreWith, submitQuiz } from "@/server/services/quizPublic";
import { exportResponses, formAnalytics, getSubmission, listResponses, overrideRecommendation, responseFilterOptions } from "@/server/services/quizReports";
import { instagramRelationship, refreshInstagramRelationship } from "@/server/services/igRelationship";
import { GraphInstagramApi, setInstagramApiForTests } from "@/server/integrations/instagram/client";
import { handleCallback, startConnect } from "@/server/integrations/instagram/oauth";
import { syncAccount } from "@/server/integrations/instagram/sync";
import { allQuestions, maxPoints, validateAnswers, validPhone } from "@/lib/quiz/engine";
import { definitionSchema } from "@/lib/quiz/schema";
import { axionApplicationDefinition } from "@/lib/quiz/templates";
import type { Answers } from "@/lib/quiz/types";
import { FakeInstagramApi, setupOrg } from "./helpers";

const DEF = axionApplicationDefinition({ relationship: () => null });
const rec = (a: Answers) => scoreWith(DEF, a);

const ID = { full_name: "Ana Souza", whatsapp: "(71) 99999-1111" };
/** Cenário A: vende recorrente, R$ 60 mil+/mês, quer acompanhamento, equipe, B1, A1. */
const A: Answers = { ...ID, business_profile: "P1", monthly_revenue_range: "R2", main_challenge: "D1", desired_outcome: "O1", operation_maturity: "M1", execution_capacity: "E1", start_timeline: "T1", investment_capacity: "B1", decision_authority: "A1" };
/** Cenário B: funcionando, R$ 50 mil/mês, quer corrigir conversão e receber plano, B2, A1. */
const B: Answers = { ...ID, business_profile: "P1", monthly_revenue_range: "R3", main_challenge: "D3", desired_outcome: "O2", operation_maturity: "M2", execution_capacity: "E2", start_timeline: "T1", investment_capacity: "B2", decision_authority: "A1" };
/** Cenário C: precisa corrigir edição, B4, sem acompanhamento amplo. */
const C: Answers = { ...ID, business_profile: "P3", monthly_revenue_range: "R4", main_challenge: "D4", desired_outcome: "O3", operation_maturity: "M3", execution_capacity: "E3", start_timeline: "T1", investment_capacity: "B4", decision_authority: "A1" };
/** Cenário D: não fatura, sem operação, quer aprender o básico. */
const D: Answers = { ...ID, business_profile: "P5", monthly_revenue_range: "R6", main_challenge: "D6", desired_outcome: "O4", operation_maturity: "M5", execution_capacity: "E4", start_timeline: "T4", investment_capacity: "B5", decision_authority: "A1" };

const meta = { ip: "10.0.0.9", userAgent: "vitest" };
const body = (answers: Answers, extra: Record<string, unknown> = {}) => ({ sessionId: randomUUID(), answers, consent: { notice: true, marketing: false }, startedAt: Date.now() - 90_000, ...extra });

describe("Quiz de Aplicação AXION — regras do documento", () => {
  it("11 perguntas, Q01/Q02 primeiro, 100 pontos e Q05/Q06 fora do score", () => {
    const qs = allQuestions(DEF);
    expect(qs).toHaveLength(11);
    expect(qs.slice(0, 2).map((q) => [q.id, q.type, q.scored])).toEqual([
      ["full_name", "short_text", false],
      ["whatsapp", "phone", false],
    ]);
    expect(maxPoints(DEF)).toBe(100);
    expect(qs.filter((q) => ["main_challenge", "desired_outcome"].includes(q.id)).every((q) => !q.scored)).toBe(true);
    expect(definitionSchema.safeParse(DEF).success).toBe(true);
    // Q05 e Q06 não mudam o score, só a sugestão.
    expect(rec({ ...A, main_challenge: "D4", desired_outcome: "O3" }).score).toBe(rec(A).score);
  });

  it("A → Mentoria; B → Consultoria; C → Sessão; D → Nutrição", () => {
    const a = rec(A);
    expect(a.score).toBe(97);
    expect(a.tier?.label).toBe("Prioridade alta");
    expect(a.recommendation).toMatchObject({ productId: "MENTORIA", needsReview: false, flags: [] });
    expect(a.recommendation!.checks.every((c) => c.ok)).toBe(true);

    const b = rec(B);
    expect(b.score).toBe(81);
    expect(b.recommendation?.productId).toBe("CONSULTORIA");

    const c = rec(C);
    expect(c.recommendation?.productId).toBe("SESSAO");
    expect(c.recommendation?.flags).toEqual(["Triagem técnica: definir se é Tráfego, Edição ou Sprint.", "Orçamento comporta a Sessão (R$ 2 mil), não a Sprint (R$ 3,7 mil)."]);

    const d = rec(D);
    expect(d.score).toBe(10);
    expect(d.tier?.label).toBe("Prioridade baixa");
    expect(d.recommendation?.productId).toBe("NUTRICAO");
  });

  it("E (B6) → Análise manual; F (receita alta, só sessão) → Sessão; G (sinais divergentes) → Análise manual; H (mentoria com B2) → Análise manual", () => {
    const e = rec({ ...A, investment_capacity: "B6" });
    expect(e.recommendation).toMatchObject({ productId: "ANALISE_MANUAL", needsReview: true });
    expect(e.recommendation?.flags).toContain("Orçamento não confirmado (B6): esclarecer na conversa, não descartar.");

    const f = rec({ ...A, monthly_revenue_range: "R1", main_challenge: "D4", desired_outcome: "O3" });
    expect(f.recommendation?.productId).toBe("SESSAO");

    const g = rec({ ...A, main_challenge: "D1", desired_outcome: "O3" });
    expect(g.recommendation).toMatchObject({ productId: "ANALISE_MANUAL", ruleId: "conflito", intent: "__conflict" });

    const h = rec({ ...A, investment_capacity: "B2" });
    expect(h.recommendation?.productId).toBe("ANALISE_MANUAL");
    expect(h.recommendation?.checks.find((x) => !x.ok)?.label).toBe("Investimento de R$ 30 mil ou mais (B1)");
    expect(h.recommendation?.reasons[1]).toMatch(/Perfil indicado para Mentoria, mas não atende/);
    expect(h.recommendation?.flags).toContain("Score alto sem produto automático: priorizar a revisão.");
  });

  it("decisor, B5, perfil de serviços e dados conflitantes", () => {
    const a3 = rec({ ...A, decision_authority: "A3" });
    expect(a3.recommendation?.productId).toBe("ANALISE_MANUAL");
    expect(a3.recommendation?.flags).toContain("Não decide sozinho (A3/A4): envolver o decisor na conversa.");
    expect(rec({ ...B, investment_capacity: "B5" }).recommendation?.productId).toBe("NUTRICAO");
    const p2 = rec({ ...B, business_profile: "P2" });
    expect(p2.recommendation?.productId).toBe("CONSULTORIA");
    expect(p2.recommendation?.flags).toContain("Perfil de serviços (P2): revisar o escopo comercial antes de fechar.");
    expect(rec({ ...A, business_profile: "P5" }).recommendation).toMatchObject({ productId: "ANALISE_MANUAL", ruleId: "inconsistencia_perfil" });
    // Sessão de R$ 2 mil com B4 não é recusada; B5 vai para nutrição.
    expect(rec({ ...C, investment_capacity: "B5" }).recommendation?.productId).toBe("NUTRICAO");
  });

  it("I: nome vazio ou WhatsApp incompleto impedem o envio", () => {
    expect(validateAnswers(DEF, { ...A, full_name: "  " }).errors.full_name).toBeTruthy();
    expect(validateAnswers(DEF, { ...A, whatsapp: "(71) 9999-111" }).errors.whatsapp).toBeTruthy();
    expect(validPhone("(71) 89999-1111")).toBe(false); // celular com 9 dígitos precisa começar com 9
    expect(validPhone("(71) 3333-4444")).toBe(true); // fixo
    expect(validPhone("+55 71 99999-1111")).toBe(true);
    expect(validPhone("+1 202 555 0123")).toBe(true); // internacional com +
    expect(validateAnswers(DEF, A).errors).toEqual({});
  });
});

describe("Quiz de Aplicação AXION — no CRM", () => {
  async function published() {
    const env = await setupOrg();
    const form = await createForm(env.ctx.admin, { name: "Aplicação AXION", template: "axion-aplicacao" });
    await publishForm(env.ctx.admin, form.id);
    return { ...env, form: await getForm(env.ctx.admin, form.id) };
  }

  it("links de origem, sugestão de produto, destino por produto e nada interno na página pública", async () => {
    const { ctx, users: u, org, form } = await published();
    expect(form.slug).toMatch(/^aplicacao-axion-/);
    expect(form.links.map((l) => [l.key, l.label])).toEqual([
      ["stories", "Stories"],
      ["grupo-whatsapp", "Grupo de WhatsApp"],
      ["trafego", "Tráfego pago"],
    ]);
    expect(form.links[0].url).toBe(`${form.publicUrl}?origem=stories`);
    const srcs = await db.select().from(leadSources).where(eq(leadSources.orgId, org.id));
    const byKey = (k: string) => srcs.find((s) => s.key === k)!.id;
    expect(form.links.map((l) => l.sourceId)).toEqual([byKey("stories"), byKey("grupo-whatsapp"), byKey("trafego-pago")]);

    const pub = await getPublicQuiz(form.slug);
    const json = JSON.stringify(pub);
    expect(json).not.toMatch(/"points"|"signal"|recommendation|MENTORIA|CONSULTORIA|"tiers"/);
    expect(json).toContain("Começar aplicação");

    // A pelo Stories → Mentoria, fila do closer, origem Stories.
    await recordEvent(form.slug, { sessionId: randomUUID(), kind: "view", origem: "stories" }, "2.2.2.2");
    const ok = await submitQuiz(form.slug, body(A, { origem: "stories" }), meta);
    expect(ok.message).toMatch(/^Recebemos suas informações/);
    expect(JSON.stringify(ok)).not.toMatch(/mentoria|score|R\$/i);
    const [sa] = await db.select().from(quizSubmissions);
    expect(sa).toMatchObject({ productId: "MENTORIA", productLabel: "Mentoria", linkKey: "stories", linkLabel: "Stories", score: 97, tierId: "prioridade_alta", phone: "+5571999991111" });
    expect(sa.utm).toMatchObject({ utm_source: "instagram", utm_medium: "stories", utm_campaign: "aplicacao" });
    const [la] = await db.select().from(leads).where(eq(leads.id, sa.leadId!));
    expect(la.sourceId).toBe(byKey("stories"));
    expect(la.assignedTo).toBe(u.closer.id);
    expect(await db.select().from(opportunities).where(eq(opportunities.contactId, sa.contactId!))).toHaveLength(1);
    const tagNames = (await db.select({ name: tags.name }).from(contactTags).innerJoin(tags, eq(tags.id, contactTags.tagId)).where(eq(contactTags.contactId, sa.contactId!))).map((t) => t.name).sort();
    expect(tagNames).toEqual(["Aplicação AXION", "Mentoria (sugerida)"]);

    // E pelo grupo de WhatsApp → Análise manual, Social Seller "Em qualificação".
    await submitQuiz(form.slug, body({ ...A, full_name: "Bruno", whatsapp: "(11) 98888-7777", investment_capacity: "B6" }, { origem: "grupo-whatsapp" }), meta);
    const [se] = await db.select().from(quizSubmissions).where(eq(quizSubmissions.linkKey, "grupo-whatsapp"));
    expect(se.productId).toBe("ANALISE_MANUAL");
    expect(await db.select().from(relationshipEntries).where(eq(relationshipEntries.contactId, se.contactId!))).toHaveLength(0);
    const [le] = await db.select().from(leads).where(eq(leads.id, se.leadId!));
    const [stage] = await db.select().from(pipelineStages).where(eq(pipelineStages.id, le.suggestedStageId!));
    expect(stage.key).toBe("em-qualificacao");

    // D sem link → Nutrição, sem aviso; origem desconhecida é ignorada.
    await submitQuiz(form.slug, body({ ...D, full_name: "Carla", whatsapp: "(21) 97777-6666" }, { origem: "nao-existe" }), meta);
    const [sd] = await db.select().from(quizSubmissions).where(eq(quizSubmissions.productId, "NUTRICAO"));
    expect(sd.linkKey).toBeNull();

    // Lista, filtros, indicadores e exportação por produto e link.
    const list = await listResponses(ctx.admin, form.id, { duplicates: "hide", product: "ANALISE_MANUAL" });
    expect(list.rows.map((r) => [r.name, r.productLabel, r.needsReview, r.origin])).toEqual([["Bruno", "Análise manual", true, "Grupo de WhatsApp"]]);
    const opts = await responseFilterOptions(ctx.admin, form.id);
    expect(opts.products.map((p) => p.id)).toEqual(expect.arrayContaining(["MENTORIA", "CONSULTORIA", "SESSAO", "NUTRICAO", "ANALISE_MANUAL"]));
    const an = await formAnalytics(ctx.admin, form.id, { duplicates: "hide" });
    expect(an.needsReview).toBe(1);
    expect(an.products.find((p) => p.id === "MENTORIA")!.count).toBe(1);
    expect(an.links.find((l) => l.key === "stories")).toMatchObject({ views: 1, completed: 1, qualified: 1 });
    const csv = (await exportResponses(ctx.admin, form.id, { duplicates: "hide" }, "csv")).body.toString("utf8");
    expect(csv).toContain("Produto sugerido");
    expect(csv).toContain("Orçamento não confirmado (B6)");

    // Ajuste manual: muda o produto final sem apagar a sugestão original; dá para desfazer.
    const adj = await overrideRecommendation(ctx.closer, se.id, { productId: "MENTORIA", sessionInterest: null, note: "Orçamento confirmado na call" }).catch((e) => e);
    expect(adj).toMatchObject({ code: "not_found" }); // closer não vê contato que não é dele
    const done = await overrideRecommendation(ctx.admin, se.id, { productId: "MENTORIA", sessionInterest: null, note: "Orçamento confirmado na call" });
    expect(done.recommendation).toMatchObject({ productId: "ANALISE_MANUAL", finalProductId: "MENTORIA", needsReview: false });
    expect(done.recommendation?.override).toMatchObject({ productLabel: "Mentoria", note: "Orçamento confirmado na call", byName: "Admin" });
    const [raw] = await db.select().from(quizSubmissions).where(eq(quizSubmissions.id, se.id));
    expect(raw.productId).toBe("ANALISE_MANUAL");
    const hist = await db.select().from(quizScoreHistory).where(eq(quizScoreHistory.submissionId, se.id));
    expect(hist.map((h) => h.reason)).toEqual(["Cálculo no envio", "Ajuste manual: Análise manual → Mentoria · Orçamento confirmado na call"]);
    expect((await listResponses(ctx.admin, form.id, { duplicates: "hide", product: "MENTORIA" })).rows).toHaveLength(2);
    const back = await overrideRecommendation(ctx.admin, se.id, { productId: null });
    expect(back.recommendation?.finalProductId).toBe("ANALISE_MANUAL");
  });

  it("links: editáveis sem publicar, chave única, origem de outra organização recusada", async () => {
    const { ctx, form } = await published();
    const other = await setupOrg("Outra");
    const [foreign] = await db.select().from(leadSources).where(eq(leadSources.orgId, other.org.id)).limit(1);
    const links = form.links.map(({ url: _u, ...l }) => l);
    await expect(saveDraft(ctx.admin, form.id, { links: [...links, { ...links[0] }] })).rejects.toMatchObject({ message: "Há dois links com a mesma chave." });
    await expect(saveDraft(ctx.admin, form.id, { links: [{ ...links[0], sourceId: foreign.id }] })).rejects.toMatchObject({ code: "invalid" });
    const saved = await saveDraft(ctx.admin, form.id, { links: [...links, { key: "bio", label: "Link da bio", kind: "bio", sourceId: null, utmSource: "instagram", utmMedium: "bio", utmCampaign: null }] });
    expect(saved.links.at(-1)).toMatchObject({ key: "bio", url: `${form.publicUrl}?origem=bio` });
    expect(saved.links.at(-1)!.sourceId).toBeTruthy();
    expect(saved.hasUnpublishedChanges).toBe(false);
    await submitQuiz(form.slug, body(B, { origem: "bio" }), meta);
    const [s] = await db.select().from(quizSubmissions);
    expect(s).toMatchObject({ linkLabel: "Link da bio", productId: "CONSULTORIA" });
  });

  it("links: origem com nome próprio é criada ao salvar, reaproveitada e vai para o lead", async () => {
    const { ctx, org, form } = await published();
    const links = form.links.map(({ url: _u, ...l }) => l);
    await expect(saveDraft(ctx.admin, form.id, { links: [{ ...links[0], newSourceName: " " }] })).rejects.toMatchObject({ code: "invalid" });
    const saved = await saveDraft(ctx.admin, form.id, { links: [{ ...links[0], newSourceName: "Live de terça" }, ...links.slice(1)] });
    const [src] = await db.select().from(leadSources).where(and(eq(leadSources.orgId, org.id), eq(leadSources.name, "Live de terça")));
    expect(src).toMatchObject({ key: "live-de-terca" });
    expect(saved.links[0]).toMatchObject({ key: "stories", sourceId: src.id });
    expect(saved.links[0]).not.toHaveProperty("newSourceName");
    // Mesmo nome (sem diferenciar maiúsculas) usa a mesma origem, sem duplicar.
    const again = await saveDraft(ctx.admin, form.id, { links: [{ ...links[0], newSourceName: "live de TERÇA" }, ...links.slice(1)] });
    expect(again.links[0].sourceId).toBe(src.id);
    expect(await db.select().from(leadSources).where(and(eq(leadSources.orgId, org.id), eq(leadSources.name, "Live de terça")))).toHaveLength(1);
    await submitQuiz(form.slug, body(B, { origem: "stories" }), meta);
    const [l] = await db.select().from(leads).where(eq(leads.orgId, org.id));
    expect(l.sourceId).toBe(src.id);
  });

  it("Configurações: origem do lead com nome próprio criada pelo editor", async () => {
    const { ctx, org, form } = await published();
    await expect(createFormSource(ctx.admin, " ")).rejects.toMatchObject({ code: "invalid" });
    const src = await createFormSource(ctx.admin, "  Parceria   Fulano ");
    expect(src.name).toBe("Parceria Fulano");
    expect((await createFormSource(ctx.admin, "parceria fulano")).id).toBe(src.id);
    const f = await getForm(ctx.admin, form.id);
    await saveDraft(ctx.admin, form.id, { draft: { ...f.draft, settings: { ...f.draft.settings, sourceId: src.id } } });
    await publishForm(ctx.admin, form.id);
    await submitQuiz(form.slug, body(B), meta);
    const [l] = await db.select().from(leads).where(eq(leads.orgId, org.id));
    expect(l.sourceId).toBe(src.id);
  });

  it("Instagram sem perguntar: @ do link personalizado (?ig=) e origem Instagram pelo app", async () => {
    const { ctx, org, form } = await published();
    // Pessoa que já conversou no Direct: a resposta cai no mesmo contato.
    const [existing] = await db.insert(contacts).values({ orgId: org.id, name: "Ana do Direct", username: "ana.souza" }).returning();

    await recordEvent(form.slug, { sessionId: randomUUID(), kind: "view", ig: "@Ana.Souza" }, "3.3.3.3");
    await submitQuiz(form.slug, body(A, { ig: "@Ana.Souza" }), meta);
    const [s1] = await db.select().from(quizSubmissions);
    expect(s1).toMatchObject({ instagram: "ana.souza", contactId: existing.id });
    expect(s1.utm).toEqual({ utm_source: "instagram", utm_medium: "direct" });
    const shared = await shareableForms(ctx.closer);
    expect(shared).toEqual([{ id: form.id, name: form.name, url: form.publicUrl, origem: null }]);

    // Link do Stories com @: as UTMs do link continuam mandando.
    await submitQuiz(form.slug, body({ ...B, whatsapp: "(11) 97777-1234" }, { origem: "stories", ig: "instagram.com/bruno_b" }), meta);
    const [s2] = await db.select().from(quizSubmissions).where(eq(quizSubmissions.instagram, "bruno_b"));
    expect(s2.utm).toMatchObject({ utm_source: "instagram", utm_medium: "stories" });

    // Link comum aberto no app do Instagram: sem @, mas com origem Instagram.
    const igUa = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Instagram 312.0.0.0";
    await submitQuiz(form.slug, body({ ...D, full_name: "Carla", whatsapp: "(21) 97777-6666" }), { ...meta, userAgent: igUa });
    const [s3] = await db.select().from(quizSubmissions).where(eq(quizSubmissions.name, "Carla"));
    expect(s3.instagram).toBeNull();
    expect(s3.utm).toEqual({ utm_source: "instagram" });

    // Fora do Instagram e sem link: nada é inventado; valor inválido no ?ig= é ignorado.
    await submitQuiz(form.slug, body({ ...D, full_name: "Davi", whatsapp: "(31) 96666-5555" }, { ig: "não é um @!" }), meta);
    const [s4] = await db.select().from(quizSubmissions).where(eq(quizSubmissions.name, "Davi"));
    expect(s4.instagram).toBeNull();
    expect(s4.utm).toEqual({});
  });

  it("K: falha na integração com o CRM nunca vira sucesso e nada fica pela metade", async () => {
    const { form } = await published();
    await db.update(quizForms).set({ leadFormId: null }).where(eq(quizForms.id, form.id));
    await expect(submitQuiz(form.slug, body(A), meta)).rejects.toMatchObject({ message: expect.stringMatching(/integração com o CRM/) });
    expect(await db.select().from(quizSubmissions)).toHaveLength(0);
    expect(await db.select().from(leads)).toHaveLength(0);
  });
});

describe("Relacionamento no Instagram", () => {
  let api: FakeInstagramApi;
  beforeEach(() => {
    api = new FakeInstagramApi();
    setInstagramApiForTests(api);
  });

  it("mostra se segue a conta, desde quando o CRM confirmou e as interações (Direct, Stories, comentários)", async () => {
    const s = await setupOrg();
    const url = new URL(await startConnect(s.ctx.admin));
    await handleCallback({ code: "abc", state: url.searchParams.get("state") }, s.ctx.admin);
    const [acc] = await db.select().from(connectedAccounts);
    await db.update(connectedAccounts).set({ connectedAt: new Date(Date.now() - 3 * 86400_000) }).where(eq(connectedAccounts.id, acc.id));
    const IG = acc.externalAccountId;
    const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400_000).toISOString();
    api.profiles["igsid-bia"] = { name: "Bia", username: "bia", followsBusiness: true, followerCount: 1520 };
    api.conversations = [
      {
        id: "t1",
        participants: [{ id: IG }, { id: "igsid-bia", username: "bia" }],
        messages: [
          { id: "m3", createdTime: iso(1), fromId: "igsid-bia", text: "quero saber da mentoria", attachments: [] },
          { id: "m2", createdTime: iso(40), fromId: "igsid-bia", text: "amei", attachments: [{ type: "story_reply", url: "https://cdn/s" }] },
          { id: "m1", createdTime: iso(95), fromId: "igsid-bia", attachments: [{ type: "story_mention", url: "https://cdn/m" }] },
        ],
      },
    ];
    const [fresh] = await db.select().from(connectedAccounts);
    await syncAccount(fresh, { parts: ["directs"] });
    await syncAccount(fresh, { parts: ["directs"] }); // perfis pendentes são consultados na sincronização
    const [ident] = await db.select().from(channelIdentities).where(eq(channelIdentities.externalId, "igsid-bia"));
    expect(ident).toMatchObject({ followsBusiness: true, followerCount: 1520 });
    expect(ident.followFirstSeenAt).toBeInstanceOf(Date);

    const r = await instagramRelationship(s.ctx.admin, ident.contactId);
    expect(r).toMatchObject({ linked: true, followsBusiness: true, followerCount: 1520, storyReplies: 1, storyMentions: 1, messages: { inbound: 3, outbound: 0 } });
    expect(Math.round((Date.now() - r.firstInteractionAt!.getTime()) / 86400_000)).toBe(95);
    expect(r.canRefresh).toBe(false);
    // Social seller sem acesso ao contato não vê.
    await expect(instagramRelationship(s.ctx.seller, ident.contactId)).rejects.toMatchObject({ code: "not_found" });

    // Deixou de seguir: a próxima consulta (depois de 10 min) registra.
    api.profiles["igsid-bia"] = { name: "Bia", username: "bia", followsBusiness: false };
    await db.update(channelIdentities).set({ followCheckedAt: new Date(Date.now() - 3600_000), profileCheckedAt: new Date(Date.now() - 3600_000) }).where(eq(channelIdentities.id, ident.id));
    const after = await refreshInstagramRelationship(s.ctx.admin, ident.contactId);
    expect(after).toMatchObject({ followsBusiness: false, followConfirmedSince: null });
    // Limite: consultar de novo logo em seguida não chama a API.
    const before = api.count("getUserProfile");
    await refreshInstagramRelationship(s.ctx.admin, ident.contactId);
    expect(api.count("getUserProfile")).toBe(before);
    const [still] = await db.select().from(channelIdentities).where(and(eq(channelIdentities.id, ident.id)));
    expect(still.followsBusiness).toBe(false);
  });

  it("cliente: pede os campos de relacionamento e, se a Meta recusar, fica só com nome e foto", async () => {
    const urls: URL[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (u: URL | string) => {
      const url = new URL(String(u));
      urls.push(url);
      if (url.searchParams.get("fields")?.includes("is_user_follow_business")) return new Response(JSON.stringify({ error: { message: "Unsupported field", code: 100 } }), { status: 400 });
      return new Response(JSON.stringify({ name: "Bia", username: "bia", profile_pic: "https://cdn/p.jpg" }), { status: 200 });
    }) as typeof fetch;
    try {
      const p = await new GraphInstagramApi().getUserProfile("TOKEN", "igsid-1");
      expect(p).toEqual({ name: "Bia", username: "bia", profilePic: "https://cdn/p.jpg", followerCount: undefined, followsBusiness: undefined, businessFollowsUser: undefined, verified: undefined });
      expect(urls.map((u) => u.searchParams.get("fields"))).toEqual(["name,username,profile_pic,follower_count,is_user_follow_business,is_business_follow_user,is_verified_user", "name,username,profile_pic"]);
    } finally {
      globalThis.fetch = real;
    }
  });
});
