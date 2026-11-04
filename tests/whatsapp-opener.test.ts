import { describe, expect, it } from "vitest";
import { greetingForHour, whatsappLink, whatsappOpener } from "@/lib/format";

// Salvador (America/Bahia) = UTC−3.
const at = (hhmm: string) => new Date(`2026-11-04T${hhmm}:00-03:00`);

describe("mensagem padrão do WhatsApp", () => {
  it("troca a saudação pelo horário de Salvador", () => {
    expect(greetingForHour(at("04:59"))).toBe("Boa noite");
    expect(greetingForHour(at("05:00"))).toBe("Bom dia");
    expect(greetingForHour(at("11:59"))).toBe("Bom dia");
    expect(greetingForHour(at("12:00"))).toBe("Boa tarde");
    expect(greetingForHour(at("17:59"))).toBe("Boa tarde");
    expect(greetingForHour(at("18:00"))).toBe("Boa noite");
    expect(greetingForHour(at("23:30"))).toBe("Boa noite");
  });

  it("usa exatamente o texto pedido, com o primeiro nome", () => {
    expect(whatsappOpener("Ana Paula Souza", at("15:00"))).toBe("Boa tarde Ana, tá por aí?👀");
    expect(whatsappOpener("  JOÃO silva", at("09:00"))).toBe("Bom dia João, tá por aí?👀");
    expect(whatsappOpener("", at("20:00"))).toBe("Boa noite, tá por aí?👀");
    expect(whatsappOpener(null, at("20:00"))).toBe("Boa noite, tá por aí?👀");
  });

  it("vai codificado no link wa.me", () => {
    const href = whatsappLink("71999991111", whatsappOpener("Ana", at("15:00")))!;
    expect(decodeURIComponent(href.split("?text=")[1])).toBe("Boa tarde Ana, tá por aí?👀");
  });
});
