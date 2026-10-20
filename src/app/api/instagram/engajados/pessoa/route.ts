import { authed, json, parseQuery } from "@/server/http";
import { engagementPerson, personSchema } from "@/server/services/engagement";

/** Perfil detalhado de um engajado: resumo do período e histórico de atividades. */
export const GET = authed(async (req, ctx) => json(await engagementPerson(ctx, parseQuery(req, personSchema))));
