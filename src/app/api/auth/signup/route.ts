import { clientIp, json, parseBody, publicRoute } from "@/server/http";
import { requestSignup, signupOrganization, signupSchema } from "@/server/auth/signup";

/** Informa se o cadastro está aberto (sem expor nomes de organizações). */
export const GET = publicRoute(async () => json({ open: !!(await signupOrganization()) }), { csrf: false });

export const POST = publicRoute(async (req) => json(await requestSignup(await parseBody(req, signupSchema), clientIp(req)), 201));
