import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { buildMe } from "@/server/services/me";
import { listMembers } from "@/server/services/team";
import { getAvatar, removeAvatar, setAvatar, sniffImage } from "@/server/services/avatars";
import { setupOrg } from "./helpers";

async function photo(w = 1200, h = 800, format: "jpeg" | "png" = "jpeg") {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 20, g: 160, b: 110 } } })
    .withMetadata({ exif: { IFD0: { Artist: "segredo" } } })
    [format]()
    .toBuffer();
}

describe("foto de perfil", () => {
  it("recorta em quadrado, remove metadados e aparece no perfil e na equipe", async () => {
    const { ctx, users: u } = await setupOrg();
    const { avatarUrl } = await setAvatar(ctx.seller, await photo());
    expect(avatarUrl).toMatch(new RegExp(`^/api/users/${u.seller.id}/avatar\\?v=\\d+$`));

    const row = await getAvatar(ctx.admin, u.seller.id);
    expect(row.mime).toBe("image/webp");
    const meta = await sharp(row.data).metadata();
    expect([meta.width, meta.height]).toEqual([512, 512]);
    expect(meta.exif).toBeUndefined();

    expect((await buildMe(ctx.seller)).user.avatarUrl).toBe(avatarUrl);
    expect((await listMembers(ctx.manager)).find((m) => m.userId === u.seller.id)?.avatarUrl).toBe(avatarUrl);
    expect((await listMembers(ctx.manager)).find((m) => m.userId === u.admin.id)?.avatarUrl).toBeNull();

    await removeAvatar(ctx.seller);
    expect((await buildMe(ctx.seller)).user.avatarUrl).toBeNull();
    await expect(getAvatar(ctx.admin, u.seller.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("recusa arquivos que não são imagem, mesmo com nome de imagem", async () => {
    const { ctx } = await setupOrg();
    await expect(setAvatar(ctx.seller, Buffer.from("<svg onload=alert(1)>"))).rejects.toMatchObject({ code: "invalid" });
    await expect(setAvatar(ctx.seller, Buffer.from("GIF89a....."))).rejects.toMatchObject({ code: "invalid" });
    await expect(setAvatar(ctx.seller, Buffer.alloc(0))).rejects.toMatchObject({ code: "invalid" });
    // cabeçalho de JPEG com conteúdo corrompido
    await expect(setAvatar(ctx.seller, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(200, 7)]))).rejects.toMatchObject({ code: "invalid" });
    expect(sniffImage(await photo(10, 10, "png"))).toBe("image/png");
  });

  it("foto de quem é de outra organização não é acessível", async () => {
    const { ctx, users: u } = await setupOrg();
    await setAvatar(ctx.seller, await photo(300, 300, "png"));
    const other = await setupOrg();
    await expect(getAvatar(other.ctx.admin, u.seller.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(getAvatar(ctx.closer, "../../etc/passwd")).rejects.toMatchObject({ code: "not_found" });
  });
});
