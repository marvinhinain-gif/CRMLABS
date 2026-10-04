import { z } from "zod";
import { authed, json, parseQuery } from "@/server/http";
import { listContacts } from "@/server/services/contacts";
import { listConversations } from "@/server/services/conversations";

export const GET = authed(async (req, ctx) => {
  const { q } = parseQuery(req, z.object({ q: z.string().trim().min(1).max(100) }));
  const [contacts, conversations] = await Promise.all([
    listContacts(ctx, { q, page: 1, pageSize: 6 }),
    listConversations(ctx, { q, filter: "all", limit: 5 }),
  ]);
  return json({ contacts: contacts.rows, conversations: conversations.rows });
});
