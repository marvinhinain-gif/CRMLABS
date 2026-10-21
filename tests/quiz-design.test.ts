import { describe, expect, it } from "vitest";
import { definitionSchema } from "@/lib/quiz/schema";
import { axionApplicationDefinition, axionDefinition, blankDefinition, DEFAULT_APPEARANCE } from "@/lib/quiz/templates";
import { publicDefinition } from "@/lib/quiz/engine";

const refs = { relationship: () => null };

describe("Design padrão dos quizzes (Cartão AXION)", () => {
  it("novos formulários e modelos já saem no cartão", () => {
    expect(DEFAULT_APPEARANCE).toMatchObject({ preset: "axion_card", frame: "card", surface: "#ffffff", buttonStyle: "outline", counter: "question" });
    for (const def of [blankDefinition(), axionDefinition(refs), axionApplicationDefinition(refs)]) {
      expect(def.appearance.frame).toBe("card");
      expect(definitionSchema.safeParse(def).success).toBe(true);
    }
  });

  it("formulários antigos, sem moldura, continuam válidos e na página inteira", () => {
    const old = blankDefinition();
    old.appearance = { ...old.appearance, preset: "axion", frame: undefined, surface: undefined };
    const parsed = definitionSchema.parse(old);
    expect(parsed.appearance.frame).toBeUndefined();
  });

  it("a página pública recebe a moldura e a cor do cartão", () => {
    const pub = publicDefinition(axionApplicationDefinition(refs));
    expect(pub.appearance.frame).toBe("card");
    expect(pub.appearance.surface).toBe("#ffffff");
    expect(pub.settings.welcome).toBe("11 perguntas · leva de 2 a 3 minutos");
  });

  it("rejeita cor do cartão inválida", () => {
    const def = blankDefinition();
    def.appearance.surface = "branco";
    expect(definitionSchema.safeParse(def).success).toBe(false);
  });
});

describe("Formulário em branco", () => {
  it("já abre na tela do cartão, com descrição", () => {
    const def = blankDefinition();
    expect(def.settings.description).toBeTruthy();
    expect(def.appearance.frame).toBe("card");
  });
});
