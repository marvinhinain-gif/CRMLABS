import { authed, json } from "@/server/http";
import { invalid } from "@/server/errors";
import { ASSET_MAX_UPLOAD, assertForms, uploadAsset } from "@/server/services/quizzes";

/** Imagem do formulário (multipart: "file" e "kind" = logo | cover | image). */
export const POST = authed(async (req, ctx) => {
  assertForms(ctx);
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > ASSET_MAX_UPLOAD + 64 * 1024) throw invalid("Imagem grande demais (máximo 8 MB).");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw invalid("Envio inválido. Tente novamente.");
  }
  const file = form.get("file");
  const kind = String(form.get("kind") ?? "image");
  if (!file || typeof file === "string") throw invalid("Escolha uma imagem.");
  if (file.size > ASSET_MAX_UPLOAD) throw invalid("Imagem grande demais (máximo 8 MB).");
  return json(await uploadAsset(ctx, Buffer.from(await file.arrayBuffer()), kind === "logo" || kind === "cover" ? kind : "image"), 201);
});
