import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { leads } from "@/server/db/schema";
import { createForm, getForm, publishForm } from "@/server/services/quizzes";
import { submitQuiz } from "@/server/services/quizPublic";
import { exportLeads, forwardLeadToKanban, listLeads, updateLead } from "@/server/services/leads";
import { createForm as createIntegration, ingestWebhookLead, listForms } from "@/server/services/integrations";
import { buyingPowerLabel } from "@/lib/leadScore";
import type { Answers } from "@/lib/quiz/types";
import { setupOrg } from "./helpers";

const meta = { ip: "10.0.0.9", userAgent: "vitest" };
const body = (answers: Answers) => ({ sessionId: randomUUID(), answers, consent: { notice: true, marketing: false }, startedAt: Date.now() - 90_000 });
const base: Answers = { business_profile: "P3", monthly_revenue_range: "R4", main_challenge: "D4", desired_outcome: "O3", operation_maturity: "M3", execution_capacity: "E3", start_timeline: "T1", investment_capacity: "B4", decision_authority: "A1" };
const person = (name: string, phone: string) => ({ full_name: name, whatsapp: phone });
const names = (rows: { name: string }[]) => rows.map((r) => r.name);

describe("Comunidade El Club: leads sem dono por poder de compra", () => {
  it("separa quente (informou quanto investe ou fatura) de frio, quentes primeiro, e ordena por data", async () => {
    const { ctx } = await setupOrg();
    const created = await createForm(ctx.admin, { name: "Aplicação AXION", template: "axion-aplicacao" });
    await publishForm(ctx.admin, created.id);
    const form = await getForm(ctx.admin, created.id);
    // Quem cai em Sessão/Consultoria/Mentoria vai para o closer; a comunidade fica com os que ficaram sem dono.
    await submitQuiz(form.slug, body({ ...base, business_profile: "P5", monthly_revenue_range: "R6", investment_capacity: "B5", ...person("Ana", "(71) 99999-1111") }), meta); // abaixo de R$ 2 mil: quente
    await submitQuiz(form.slug, body({ ...base, ...person("Iara", "(71) 99999-9999") }), meta); // Sessão: vai para o closer, sai
    await submitQuiz(form.slug, body({ ...base, investment_capacity: "B6", monthly_revenue_range: "R6", ...person("Beto", "(71) 99999-2222") }), meta); // não disse valor: frio
    await submitQuiz(form.slug, body({ ...base, investment_capacity: "B6", ...person("Cida", "(71) 99999-3333") }), meta); // fatura R4: quente

    await createIntegration(ctx.admin, { name: "Landing", headline: "Fale com a gente", questions: [] });
    const token = (await listForms(ctx.admin)).find((f) => f.name === "Landing")!.webhookUrl!.split("/").pop()!;
    await ingestWebhookLead(token, { nome: "Dani", whatsapp: "71 98888-1111", "Quanto você pode investir?": "Até R$ 500" }); // externo: quente
    await ingestWebhookLead(token, { nome: "Edu", whatsapp: "71 98888-2222" }); // frio
    await ingestWebhookLead(token, { nome: "Fábio", whatsapp: "71 98888-3333", "Quanto você pode investir?": "Ainda não sei" }); // frio
    await ingestWebhookLead(token, { nome: "Gabi", whatsapp: "71 98888-4444", "Quanto fatura?": "R$ 20 mil" }); // sai: vai para o Kanban
    await ingestWebhookLead(token, { nome: "Hugo", whatsapp: "71 98888-5555", "Quanto fatura?": "R$ 5 mil" }); // sai: tem responsável

    // Datas distintas para a ordem ficar previsível (Ana a mais antiga, Hugo o mais recente).
    const all = await db.select({ id: leads.id, name: leads.name }).from(leads);
    const order = ["Iara", "Ana", "Beto", "Cida", "Dani", "Edu", "Fábio", "Gabi", "Hugo"];
    for (const l of all) await db.update(leads).set({ createdAt: new Date(Date.UTC(2026, 10, 1 + order.indexOf(l.name))) }).where(eq(leads.id, l.id));
    const id = (n: string) => all.find((l) => l.name === n)!.id;
    await forwardLeadToKanban(ctx.seller, id("Gabi"), {});
    await updateLead(ctx.admin, id("Hugo"), { assignedTo: ctx.seller2.userId });

    const list = (f: Partial<Parameters<typeof listLeads>[1]> = {}) => listLeads(ctx.admin, { status: "comunidade", page: 1, ...f });
    let res = await list();
    expect(names(res.rows)).toEqual(["Dani", "Cida", "Ana", "Fábio", "Edu", "Beto"]);
    expect(res.community).toEqual({ total: 6, quente: 3, frio: 3 });
    expect(res.rows.find((r) => r.name === "Dani")!.buyingPower).toBe("Até R$ 500");
    expect(buyingPowerLabel(res.rows.find((r) => r.name === "Ana")!.buyingPower)).toBe("Investimento: Abaixo de R$ 2.000");
    expect(res.rows.find((r) => r.name === "Cida")!.buyingPower).toBe("Faturamento: R$ 10 mil a R$ 29.999");
    expect(buyingPowerLabel("B2")).toBe("Investimento: R$ 12.000 a R$ 29.999");
    expect(res.rows.find((r) => r.name === "Beto")!.buyingPower).toBeNull();

    res = await list({ temp: "quente", ordem: "antigos" });
    expect(names(res.rows)).toEqual(["Ana", "Cida", "Dani"]);
    res = await list({ temp: "frio" });
    expect(names(res.rows)).toEqual(["Fábio", "Edu", "Beto"]);
    res = await list({ ordem: "antigos" });
    expect(names(res.rows)).toEqual(["Ana", "Cida", "Dani", "Beto", "Edu", "Fábio"]);

    // Ordem vale também nas outras abas.
    expect(names((await listLeads(ctx.admin, { status: "all", page: 1, ordem: "antigos" })).rows)[0]).toBe("Iara");

    // SDR vê a mesma fila; a planilha leva o poder de compra.
    expect((await listLeads(ctx.seller, { status: "comunidade", page: 1 })).community).toEqual({ total: 6, quente: 3, frio: 3 });
    const file = await exportLeads(ctx.admin, { status: "comunidade", temp: "quente", format: "csv" });
    const csv = file.body.toString("utf8");
    expect(csv).toContain("Poder de compra");
    expect(csv).toContain("Até R$ 500");
    expect(csv).not.toContain("Beto");
  });
});
