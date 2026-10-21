import { authed, json, parseBody } from "@/server/http";
import { caktoSettingsSchema, caktoSetup, saveCaktoSettings } from "@/server/services/checkout";

/** Configuração da Cakto — somente administrador. Segredos nunca voltam. */
export const GET = authed(async (_req, ctx) => json(await caktoSetup(ctx)));
export const PUT = authed(async (req, ctx) => json(await saveCaktoSettings(ctx, await parseBody(req, caktoSettingsSchema))));
