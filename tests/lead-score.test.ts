import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { leads, quizSubmissions } from "@/server/db/schema";
import { createForm, getForm, publishForm } from "@/server/services/quizzes";
import { submitQuiz } from "@/server/services/quizPublic";
import { overrideRecommendation } from "@/server/services/quizReports";
import { getLead, listLeads, updateLead } from "@/server/services/leads";
import { createForm as createIntegration, ingestWebhookLead, listForms } from "@/server/services/integrations";
import { classFromProduct } from "@/lib/leadScore";
import type { Answers } from "@/lib/quiz/types";
import { setupOrg } from "./helpers";

const meta = { ip: "10.0.0.9", userAgent: "vitest" };
const body = (answers: Answers) => ({ sessionId: randomUUID(), answers, consent: { notice: true, marketing: false }, startedAt: Date.now() - 90_000 });
/** Mesmos cenários do teste do Quiz de Aplicação AXION. */
const A: Answers = { business_profile: "P1", monthly_revenue_range: "R2", main_challenge: "D1", desired_outcome: "O1", operation_maturity: "M1", execution_capacity: "E1", start_timeline: "T1", investment_capacity: "B1", decision_authority: "A1" };
const B: Answers = { business_profile: "P1", monthly_revenue_range: "R3", main_challenge: "D3", desired_outcome: "O2", operation_maturity: "M2", execution_capacity: "E2", start_timeline: "T1", investment_capacity: "B2", decision_authority: "A1" };
const C: Answers = { business_profile: "P3", monthly_revenue_range: "R4", main_challenge: "D4", desired_outcome: "O3", operation_maturity: "M3", execution_capacity: "E3", start_timeline: "T1", investment_capacity: "B4", decision_authority: "A1" };
const D: Answers = { business_profile: "P5", monthly_revenue_range: "R6", main_challenge: "D6", desired_outcome: "O4", operation_maturity: "M5", execution_capacity: "E4", start_timeline: "T4", investment_capacity: "B5", decision_authority: "A1" };
const person = (name: string, phone: string) => ({ full_name: name, whatsapp: phone });

const all = { status: "all" as const, page: 1 };
const byName = <T extends { name: string }>(rows: T[], name: string) => rows.find((r) => r.name === name)!;

describe("Lead score por produto nos Leads", () => {
  it("produto sugerido → classe", () => {
    expect(classFromProduct("MENTORIA", "Mentoria")).toBe("MENTORIA");
    expect(classFromProduct("CONSULTORIA", "Consultoria")).toBe("CONSULTORIA");
    expect(classFromProduct("SESSAO", "Sessão Estratégica")).toBe("SESSAO");
    expect(classFromProduct("NUTRICAO", "Nutrição")).toBe("NAO_ICP");
    expect(classFromProduct("ANALISE_MANUAL", "Análise manual")).toBeNull();
    expect(classFromProduct("x1", "Mentoria 90 dias")).toBe("MENTORIA");
    expect(classFromProduct(null, null)).toBeNull();
  });

  it("classifica pela aplicação, filtra, conta e aceita ajuste manual", async () => {
    const { ctx } = await setupOrg();
    const created = await createForm(ctx.admin, { name: "Aplicação AXION", template: "axion-aplicacao" });
    await publishForm(ctx.admin, created.id);
    const form = await getForm(ctx.admin, created.id);
    await submitQuiz(form.slug, body({ ...A, ...person("Ana", "(71) 99999-1111") }), meta);
    await submitQuiz(form.slug, body({ ...B, ...person("Bruno", "(71) 99999-2222") }), meta);
    await submitQuiz(form.slug, body({ ...C, ...person("Carla", "(71) 99999-3333") }), meta);
    await submitQuiz(form.slug, body({ ...D, ...person("Davi", "(71) 99999-4444") }), meta);
    await submitQuiz(form.slug, body({ ...A, investment_capacity: "B6", ...person("Eva", "(71) 99999-5555") }), meta);

    const list = await listLeads(ctx.admin, all);
    expect(Object.fromEntries(list.rows.map((r) => [r.name, r.scoreClass]))).toEqual({ Ana: "MENTORIA", Bruno: "CONSULTORIA", Carla: "SESSAO", Davi: "NAO_ICP", Eva: null });
    expect(byName(list.rows, "Ana")).toMatchObject({ score: 97, scoreClassManual: false });
    expect(list.classCounts).toEqual({ MENTORIA: 1, CONSULTORIA: 1, SESSAO: 1, NAO_ICP: 1, none: 1 });

    expect((await listLeads(ctx.admin, { ...all, classe: "MENTORIA" })).rows.map((r) => r.name)).toEqual(["Ana"]);
    expect((await listLeads(ctx.admin, { ...all, classe: "none" })).rows.map((r) => r.name)).toEqual(["Eva"]);

    // Análise manual: a equipe decide no lead.
    const eva = byName(list.rows, "Eva");
    let detail = await getLead(ctx.admin, eva.id);
    expect(detail.leadScore).toMatchObject({ class: null, auto: null, manual: null, application: { productLabel: "Análise manual", needsReview: true, formTitle: "Aplicação AXION" } });
    await updateLead(ctx.admin, eva.id, { scoreClass: "CONSULTORIA" });
    detail = await getLead(ctx.admin, eva.id);
    expect(detail.leadScore).toMatchObject({ class: "CONSULTORIA", auto: null, manual: { byName: "Admin" } });
    expect((await listLeads(ctx.admin, { ...all, classe: "CONSULTORIA" })).rows.map((r) => r.name).sort()).toEqual(["Bruno", "Eva"]);

    // O ajuste manual vence o quiz; null volta para o quiz.
    const ana = byName(list.rows, "Ana");
    await updateLead(ctx.admin, ana.id, { scoreClass: "NAO_ICP" });
    expect(byName((await listLeads(ctx.admin, all)).rows, "Ana")).toMatchObject({ scoreClass: "NAO_ICP", scoreClassManual: true });
    await updateLead(ctx.admin, ana.id, { scoreClass: null });
    const [row] = await db.select().from(leads).where(eq(leads.id, ana.id));
    expect(row).toMatchObject({ scoreClass: null, scoreClassBy: null, scoreClassAt: null });
    expect((await getLead(ctx.admin, ana.id)).leadScore).toMatchObject({ class: "MENTORIA", auto: "MENTORIA", manual: null });

    // Ajuste do produto feito na resposta do quiz também muda a classe.
    const [sub] = await db.select().from(quizSubmissions).where(eq(quizSubmissions.leadId, byName(list.rows, "Carla").id));
    await overrideRecommendation(ctx.admin, sub.id, { productId: "MENTORIA" });
    expect(byName((await listLeads(ctx.admin, all)).rows, "Carla").scoreClass).toBe("MENTORIA");
  });

  it("lead de outra integração herda a classe de quem já respondeu a aplicação; sem aplicação = a classificar", async () => {
    const { ctx } = await setupOrg();
    const created = await createForm(ctx.admin, { name: "Aplicação AXION", template: "axion-aplicacao" });
    await publishForm(ctx.admin, created.id);
    const form = await getForm(ctx.admin, created.id);
    await submitQuiz(form.slug, body({ ...B, ...person("Bruno", "(71) 99999-2222") }), meta);

    await createIntegration(ctx.admin, { name: "Landing", headline: "Fale com a gente", questions: [] });
    const token = (await listForms(ctx.admin)).find((f) => f.name === "Landing")!.webhookUrl!.split("/").pop()!;
    await ingestWebhookLead(token, { nome: "Bruno", whatsapp: "71 99999-2222" });
    await ingestWebhookLead(token, { nome: "Zeca", whatsapp: "71 98888-7777" });

    const rows = (await listLeads(ctx.admin, all)).rows;
    const brunos = rows.filter((r) => r.name === "Bruno");
    expect(brunos.length).toBeGreaterThan(0);
    expect(brunos.every((r) => r.scoreClass === "CONSULTORIA")).toBe(true);
    const zeca = byName(rows, "Zeca");
    expect(zeca).toMatchObject({ scoreClass: null, score: null });
    expect((await getLead(ctx.admin, zeca.id)).leadScore).toEqual({ class: null, auto: null, manual: null, application: null });
  });
});
