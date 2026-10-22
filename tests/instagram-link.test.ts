import { describe, expect, it } from "vitest";
import { cameFromInstagram, instagramUtm, linkHandle, personalLink } from "@/lib/quiz/instagramLink";

describe("Instagram no link do formulário", () => {
  it("lê o @ do ?ig= em vários formatos e ignora lixo", () => {
    expect(linkHandle("fulano")).toBe("fulano");
    expect(linkHandle("@Fulano.Silva")).toBe("fulano.silva");
    expect(linkHandle("https://www.instagram.com/fulano_/")).toBe("fulano_");
    expect(linkHandle("{{username}}")).toBeNull();
    expect(linkHandle("")).toBeNull();
  });

  it("reconhece o navegador do app e links do Instagram", () => {
    expect(cameFromInstagram("Mozilla/5.0 ... Instagram 312.0.0.0 (iPhone)", null)).toBe(true);
    expect(cameFromInstagram("Mozilla/5.0 Safari", "https://l.instagram.com/?u=x")).toBe(true);
    expect(cameFromInstagram("Mozilla/5.0 Safari", "https://notinstagram.com/")).toBe(false);
    expect(cameFromInstagram(null, "lixo")).toBe(false);
  });

  it("só completa a origem quando o link não trouxe UTM", () => {
    expect(instagramUtm({ utm_source: "meta" }, "fulano", true)).toEqual({ utm_source: "meta" });
    expect(instagramUtm({}, "fulano", false)).toEqual({ utm_source: "instagram", utm_medium: "direct" });
    expect(instagramUtm({}, null, true)).toEqual({ utm_source: "instagram" });
    expect(instagramUtm({}, null, false)).toEqual({});
  });

  it("monta o link personalizado", () => {
    expect(personalLink("https://crm.test/forms/aplicacao", "@Fulano")).toBe("https://crm.test/forms/aplicacao?ig=fulano");
    expect(personalLink("https://crm.test/forms/aplicacao", "fulano", "direct")).toBe("https://crm.test/forms/aplicacao?origem=direct&ig=fulano");
  });
});
