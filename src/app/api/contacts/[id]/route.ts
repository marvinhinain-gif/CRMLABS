import { authed, json, parseBody } from "@/server/http";
import { archiveContact, getContactDetail, updateContact, updateContactSchema } from "@/server/services/contacts";

export const GET = authed(async (_req, ctx, p) => json(await getContactDetail(ctx, p.id)));
export const PATCH = authed(async (req, ctx, p) => json(await updateContact(ctx, p.id, await parseBody(req, updateContactSchema))));
export const DELETE = authed(async (_req, ctx, p) => {
  await archiveContact(ctx, p.id);
  return json({ ok: true });
});
