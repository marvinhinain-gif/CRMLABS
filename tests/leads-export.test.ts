import { describe, expect, it } from "vitest";
import { inflateRawSync } from "node:zlib";
import { exportLeads, exportLeadsSchema, submitPublicForm } from "@/server/services/leads";
import { createForm } from "@/server/services/integrations";
import { setupOrg } from "./helpers";

const base = { consent: true as const, startedAt: Date.now() - 10_000 };

/** Lê o XML da planilha de dentro do .xlsx (zip sem dependências). */
function sheetXml(buf: Buffer) {
  let i = 0;
  while (i < buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const size = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const name = buf.subarray(i + 30, i + 30 + nameLen).toString("utf8");
    const start = i + 30 + nameLen;
    if (name === "xl/worksheets/sheet1.xml") return inflateRawSync(buf.subarray(start, start + size)).toString("utf8");
    i = start + size;
  }
  throw new Error("planilha não encontrada");
}

describe("exportar leads", () => {
  it("baixa os leads da aba com uma coluna por pergunta respondida", async () => {
    const { ctx } = await setupOrg();
    const form = await createForm(ctx.admin, {
      name: "Anúncio",
      headline: "Quero saber mais",
      questions: [
        { id: "faturamento", label: "Qual o seu faturamento mensal?", type: "choice", required: true, options: ["Até 10 mil", "10 a 50 mil"] },
        { id: "desafio", label: "Seu maior desafio hoje", type: "textarea", required: false },
      ],
    });
    await submitPublicForm(form.slug, { ...base, name: "Ana Souza", phone: "71999991111", instagram: "@anasouza", answers: { faturamento: "10 a 50 mil", desafio: "Gerar leads" } }, "1.1.1.1");
    await submitPublicForm(form.slug, { ...base, name: "Bruno Costa", phone: "71988882222", answers: { faturamento: "Até 10 mil" } }, "1.1.1.2");

    const csv = await exportLeads(ctx.admin, exportLeadsSchema.parse({ status: "all", format: "csv" }));
    expect(csv.filename).toMatch(/^leads-\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = csv.body.toString("utf8").replace(/^﻿/, "").split("\r\n");
    const header = lines[0].split(";");
    expect(header.slice(0, 3)).toEqual(["Data de entrada", "Nome", "WhatsApp"]);
    expect(header.slice(-2)).toEqual(["Qual o seu faturamento mensal?", "Seu maior desafio hoje"]);
    expect(lines).toHaveLength(3);
    const byName = Object.fromEntries(lines.slice(1).map((l) => l.split(";")).map((c) => [c[1], c]));
    expect(byName["Ana Souza"].slice(-2)).toEqual(["10 a 50 mil", "Gerar leads"]);
    expect(byName["Ana Souza"][2]).toBe("(71) 99999-1111");
    expect(byName["Ana Souza"][4]).toBe("'@anasouza"); // CSV protege contra fórmula (@)
    expect(byName["Bruno Costa"].slice(-2)).toEqual(["Até 10 mil", ""]);

    // Respeita a busca da tela; o padrão é Excel.
    const xlsx = await exportLeads(ctx.admin, exportLeadsSchema.parse({ status: "all", q: "Bruno" }));
    expect(xlsx.filename).toMatch(/\.xlsx$/);
    const xml = sheetXml(xlsx.body);
    expect(xml).toContain("Bruno Costa");
    expect(xml).not.toContain("Ana Souza");
  });

  it("só administradores e gestores exportam", async () => {
    const { ctx } = await setupOrg();
    await expect(exportLeads(ctx.seller, exportLeadsSchema.parse({ status: "all" }))).rejects.toMatchObject({ code: "forbidden" });
    await expect(exportLeads(ctx.closer, exportLeadsSchema.parse({ status: "all" }))).rejects.toMatchObject({ code: "forbidden" });
    await expect(exportLeads(ctx.manager, exportLeadsSchema.parse({ status: "all" }))).resolves.toBeTruthy();
  });
});
