import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { memberships, userAvatars } from "../db/schema";
import type { Ctx } from "../context";
import { AppError, invalid, notFound } from "../errors";
import { logger } from "../logger";
import { audit } from "./common";

/** Tamanho máximo do arquivo enviado (antes da redução). */
export const AVATAR_MAX_UPLOAD = 6 * 1024 * 1024;
/** Lado da imagem guardada. */
const SIDE = 512;
/** Sem o sharp, só aceitamos arquivos já pequenos (o navegador reduz antes de enviar). */
const MAX_RAW_STORE = 600 * 1024;

type Kind = "image/jpeg" | "image/png" | "image/webp";

/** Identifica o formato pelos bytes iniciais — o tipo declarado pelo navegador não é confiável. */
export function sniffImage(buf: Buffer): Kind | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

/**
 * Recodifica a imagem (corrige rotação, corta em quadrado, remove metadados como localização).
 * Se o sharp não estiver disponível nesta máquina, guarda o arquivo original já validado.
 */
async function normalize(buf: Buffer, kind: Kind): Promise<{ data: Buffer; mime: string }> {
  let sharp: typeof import("sharp").default | null = null;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    sharp = null;
  }
  if (sharp) {
    try {
      const data = await sharp(buf, { failOn: "error", limitInputPixels: 40_000_000 })
        .rotate()
        .resize(SIDE, SIDE, { fit: "cover", position: "attention" })
        .webp({ quality: 82 })
        .toBuffer();
      return { data, mime: "image/webp" };
    } catch (e) {
      logger.warn("Imagem de perfil recusada pelo processador", e);
      throw invalid("Não foi possível ler esta imagem. Tente outra foto (JPG, PNG ou WebP).");
    }
  }
  if (buf.length > MAX_RAW_STORE) throw invalid("Imagem grande demais. Escolha uma foto menor.");
  return { data: buf, mime: kind };
}

export function avatarUrl(userId: string, updatedAt: Date | null | undefined) {
  return updatedAt ? `/api/users/${userId}/avatar?v=${updatedAt.getTime()}` : null;
}

export async function setAvatar(ctx: Ctx, buf: Buffer) {
  if (!buf.length) throw invalid("Escolha uma imagem.");
  if (buf.length > AVATAR_MAX_UPLOAD) throw invalid("Imagem grande demais (máximo 6 MB).");
  const kind = sniffImage(buf);
  if (!kind) throw invalid("Formato não suportado. Use JPG, PNG ou WebP.");
  const { data, mime } = await normalize(buf, kind);
  const now = new Date();
  await db
    .insert(userAvatars)
    .values({ userId: ctx.userId, data, mime, updatedAt: now })
    .onConflictDoUpdate({ target: userAvatars.userId, set: { data, mime, updatedAt: now } });
  await audit(db, ctx, "profile.avatar_updated", "user", ctx.userId);
  return { avatarUrl: avatarUrl(ctx.userId, now) };
}

export async function removeAvatar(ctx: Ctx) {
  await db.delete(userAvatars).where(eq(userAvatars.userId, ctx.userId));
  await audit(db, ctx, "profile.avatar_removed", "user", ctx.userId);
}

/** Foto de um usuário: visível para ele mesmo e para quem é da mesma organização. */
export async function getAvatar(ctx: Ctx, userId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw notFound();
  if (userId !== ctx.userId) {
    const [m] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, userId)));
    if (!m) throw new AppError("not_found", "Foto não encontrada.");
  }
  const [row] = await db.select().from(userAvatars).where(eq(userAvatars.userId, userId));
  if (!row) throw new AppError("not_found", "Foto não encontrada.");
  return row;
}

export async function myAvatarUpdatedAt(userId: string) {
  const [row] = await db.select({ updatedAt: userAvatars.updatedAt }).from(userAvatars).where(eq(userAvatars.userId, userId));
  return row?.updatedAt ?? null;
}
