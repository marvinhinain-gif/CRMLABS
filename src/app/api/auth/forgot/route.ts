import { z } from "zod";
import { requestPasswordReset } from "@/server/auth/service";
import { clientIp, json, parseBody, publicRoute } from "@/server/http";
import { logger } from "@/server/logger";

const schema = z.object({ email: z.string().trim().email("Informe um e-mail válido.").max(200) });

export const POST = publicRoute(async (req) => {
  const { email } = await parseBody(req, schema);
  try {
    await requestPasswordReset(email, clientIp(req));
  } catch (e) {
    logger.error("Falha ao enviar e-mail de recuperação", e);
  }
  // Resposta sempre neutra: não revela se o e-mail existe.
  return json({ ok: true, message: "Se este e-mail estiver cadastrado, você receberá um link para redefinir a senha." });
});
