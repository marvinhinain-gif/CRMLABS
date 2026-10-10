import { authed, json, parseBody, parseQuery } from "@/server/http";
import { createForm, createFormSchema, listForms, listFormsSchema } from "@/server/services/quizzes";

export const GET = authed(async (req, ctx) => json(await listForms(ctx, parseQuery(req, listFormsSchema))));
export const POST = authed(async (req, ctx) => json(await createForm(ctx, await parseBody(req, createFormSchema)), 201));
