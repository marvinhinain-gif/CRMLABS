import { and, eq } from "drizzle-orm";
import { authed, json } from "@/server/http";
import { db } from "@/server/db";
import { contacts } from "@/server/db/schema";
import { contactScope } from "@/server/permissions";
import { notFound } from "@/server/errors";
import { contactJourney } from "@/server/services/journey";

/** Origem, jornada e dados qualificados do contato (para quem pode ver o contato). */
export const GET = authed(async (_req, ctx, p) => {
  const [c] = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, p.id), contactScope(ctx)));
  if (!c) throw notFound("Contato não encontrado.");
  return json(await contactJourney(ctx, p.id));
});
