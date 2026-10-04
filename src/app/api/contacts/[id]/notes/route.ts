import { z } from "zod";
import { authed, json, parseBody } from "@/server/http";
import { addNote } from "@/server/services/contacts";

export const POST = authed(async (req, ctx, p) => {
  const { body } = await parseBody(req, z.object({ body: z.string().max(5000) }));
  return json(await addNote(ctx, p.id, body), 201);
});
