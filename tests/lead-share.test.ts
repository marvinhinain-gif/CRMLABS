import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { leads } from "@/server/db/schema";
import { getLead, submitPublicForm } from "@/server/services/leads";
import { getSharedLead, shareLead, unshareLead } from "@/server/services/leadShare";
import { createForm } from "@/server/services/integrations";
import { setupOrg } from "./helpers";

const base = { consent: true as const, startedAt: Date.now() - 10_000 };
const tokenOf = (url: string) => url.split("/ficha/")[1];

async function leadFor() {
  const s = await setupOrg();
  const form = await createForm(s.ctx.admin, {
    name: "Mentoria — Anúncio",
    headline: "Quero saber mais",
    questions: [
      { id: "faturamento", label: "Qual o seu faturamento mensal?", type: "choice", required: true, options: ["Até 10 mil", "10 a 50 mil"] },
      { id: "desafio", label: "Seu maior desafio hoje", type: "textarea", required: false },
    ],
  });
  await submitPublicForm(form.slug, { ...base, name: "Ana Souza", phone: "(71) 99999-1111", email: "ana@x.com", instagram: "@anasouza", answers: { faturamento: "10 a 50 mil", desafio: "Gerar leads" } }, "1.1.1.1");
  const [lead] = await db.select().from(leads);
  return { ...s, lead };
}

describe("ficha do lead por link", () => {
  it("cria link público só leitura com contato e respostas do formulário", async () => {
    const { ctx, lead } = await leadFor();
    expect((await getLead(ctx.admin, lead.id)).shareUrl).toBeNull();

    const r = await shareLead(ctx.admin, lead.id);
    expect(r.url).toMatch(/\/ficha\/[A-Za-z0-9_-]{43}$/);
    // Compartilhar de novo devolve o mesmo link.
    expect((await shareLead(ctx.admin, lead.id)).url).toBe(r.url);
    expect((await getLead(ctx.admin, lead.id)).shareUrl).toBe(r.url);

    const f = await getSharedLead(tokenOf(r.url));
    expect(f).toMatchObject({ orgName: "Org Teste", name: "Ana Souza", phone: "+5571999991111", email: "ana@x.com", instagram: "anasouza", formName: "Mentoria — Anúncio" });
    expect(f!.answers).toEqual([
      { label: "Qual o seu faturamento mensal?", value: "10 a 50 mil" },
      { label: "Seu maior desafio hoje", value: "Gerar leads" },
    ]);
    // Nada de dados internos do CRM na ficha pública.
    expect(Object.keys(f!)).not.toContain("assignedTo");
    expect(Object.keys(f!)).not.toContain("contactId");
  });

  it("desativar o link derruba o endereço antigo; compartilhar de novo gera outro", async () => {
    const { ctx, lead } = await leadFor();
    const first = await shareLead(ctx.admin, lead.id);
    await unshareLead(ctx.admin, lead.id);
    expect(await getSharedLead(tokenOf(first.url))).toBeNull();
    expect((await getLead(ctx.admin, lead.id)).shareUrl).toBeNull();
    const second = await shareLead(ctx.admin, lead.id);
    expect(second.url).not.toBe(first.url);
    expect(await getSharedLead(tokenOf(second.url))).not.toBeNull();
  });

  it("tokens inválidos ou inventados não abrem nada", async () => {
    await leadFor();
    expect(await getSharedLead("")).toBeNull();
    expect(await getSharedLead("abc")).toBeNull();
    expect(await getSharedLead("x".repeat(43))).toBeNull();
    expect(await getSharedLead("' or 1=1 --")).toBeNull();
  });

  it("só compartilha quem pode ver o lead", async () => {
    const { lead } = await leadFor();
    const other = await setupOrg("Outra Org");
    await expect(shareLead(other.ctx.admin, lead.id)).rejects.toThrow(/não encontrado/);
    await expect(unshareLead(other.ctx.admin, lead.id)).rejects.toThrow(/não encontrado/);
  });
});
