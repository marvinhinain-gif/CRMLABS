import { authed, json, parseBody, parseQuery } from "@/server/http";
import { createContact, createContactSchema, listContacts, listContactsSchema } from "@/server/services/contacts";

export const GET = authed(async (req, ctx) => json(await listContacts(ctx, parseQuery(req, listContactsSchema))));
export const POST = authed(async (req, ctx) => json(await createContact(ctx, await parseBody(req, createContactSchema)), 201));
