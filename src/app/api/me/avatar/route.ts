import { authed, json } from "@/server/http";
import { invalid } from "@/server/errors";
import { AVATAR_MAX_UPLOAD, removeAvatar, setAvatar } from "@/server/services/avatars";

/** Envia a foto de perfil (multipart, campo "file"). */
export const POST = authed(async (req, ctx) => {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > AVATAR_MAX_UPLOAD + 64 * 1024) throw invalid("Imagem grande demais (máximo 6 MB).");
  let file: FormDataEntryValue | null = null;
  try {
    file = (await req.formData()).get("file");
  } catch {
    throw invalid("Envio inválido. Tente novamente.");
  }
  if (!file || typeof file === "string") throw invalid("Escolha uma imagem.");
  if (file.size > AVATAR_MAX_UPLOAD) throw invalid("Imagem grande demais (máximo 6 MB).");
  const buf = Buffer.from(await file.arrayBuffer());
  return json(await setAvatar(ctx, buf));
});

export const DELETE = authed(async (_req, ctx) => {
  await removeAvatar(ctx);
  return json({ ok: true });
});
