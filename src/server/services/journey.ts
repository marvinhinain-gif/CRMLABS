/**
 * Jornada de origem do contato: primeira e última origem, pontos de contato (formulários,
 * registros manuais) e os dados qualificados que vieram dos formulários (campos personalizados).
 * Visível para quem vê o contato; nada técnico (tokens, endereços) aparece aqui.
 */
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { contactTouchpoints, contacts, customFields, leadSources, leads, products, users } from "../db/schema";
import type { Ctx } from "../context";
import { invalid, notFound } from "../errors";
import { contactScope } from "../permissions";
import { publish } from "../realtime";
import { audit, cleanText } from "./common";

export async function contactJourney(ctx: Ctx, contactId: string) {
  const [c] = await db
    .select({ firstSourceId: contacts.firstSourceId, firstTouchAt: contacts.firstTouchAt, lastSourceId: contacts.lastSourceId, lastTouchAt: contacts.lastTouchAt })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.orgId, ctx.orgId)));
  if (!c) return null;
  const sources = await db.select({ id: leadSources.id, name: leadSources.name, color: leadSources.color }).from(leadSources).where(eq(leadSources.orgId, ctx.orgId));
  const src = (id: string | null) => sources.find((s) => s.id === id) ?? null;
  const tps = await db
    .select({
      id: contactTouchpoints.id,
      sourceId: contactTouchpoints.sourceId,
      kind: contactTouchpoints.kind,
      campaign: contactTouchpoints.campaign,
      channel: contactTouchpoints.channel,
      partner: contactTouchpoints.partner,
      adName: contactTouchpoints.adName,
      integrationName: contactTouchpoints.integrationName,
      leadId: contactTouchpoints.leadId,
      note: contactTouchpoints.note,
      occurredAt: contactTouchpoints.occurredAt,
      actorName: users.name,
    })
    .from(contactTouchpoints)
    .leftJoin(users, eq(users.id, contactTouchpoints.actorId))
    .where(and(eq(contactTouchpoints.contactId, contactId), eq(contactTouchpoints.orgId, ctx.orgId)))
    .orderBy(asc(contactTouchpoints.occurredAt))
    .limit(100);
  // Dados qualificados: o valor mais recente de cada campo personalizado vindo dos formulários.
  const lds = await db
    .select({ custom: leads.custom, productId: leads.productId, createdAt: leads.createdAt })
    .from(leads)
    .where(and(eq(leads.contactId, contactId), eq(leads.orgId, ctx.orgId)))
    .orderBy(desc(leads.createdAt))
    .limit(20);
  const fields = await db.select().from(customFields).where(and(eq(customFields.orgId, ctx.orgId), isNull(customFields.archivedAt))).orderBy(asc(customFields.position));
  const qualified = fields
    .map((f) => {
      const hit = lds.find((l) => l.custom?.[f.id]);
      return hit ? { key: f.key, label: f.label, value: hit.custom[f.id], at: hit.createdAt, showToCloser: f.showToCloser } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  const productIds = [...new Set(lds.map((l) => l.productId).filter((x): x is string => !!x))];
  const prods = productIds.length ? await db.select({ id: products.id, name: products.name }).from(products).where(inArray(products.id, productIds)) : [];
  const latestProduct = lds.find((l) => l.productId)?.productId;
  return {
    first: c.firstSourceId ? { ...src(c.firstSourceId)!, at: c.firstTouchAt } : null,
    last: c.lastSourceId ? { ...src(c.lastSourceId)!, at: c.lastTouchAt } : null,
    product: latestProduct ? (prods.find((p) => p.id === latestProduct)?.name ?? null) : null,
    touchpoints: tps.map((t) => ({ ...t, source: src(t.sourceId) })),
    qualified,
  };
}

export const touchpointSchema = z.object({
  sourceId: z.string().uuid(),
  campaign: z.string().trim().max(160).nullish(),
  partner: z.string().trim().max(120).nullish(),
  note: z.string().trim().max(500).nullish(),
});

/** Registro manual de origem (ex.: "voltou pelos Stories"). Primeira origem nunca é sobrescrita. */
export async function addTouchpoint(ctx: Ctx, contactId: string, input: z.infer<typeof touchpointSchema>) {
  const [c] = await db.select().from(contacts).where(and(eq(contacts.id, contactId), contactScope(ctx)));
  if (!c) throw notFound("Contato não encontrado.");
  const [s] = await db.select({ id: leadSources.id, name: leadSources.name }).from(leadSources).where(and(eq(leadSources.id, input.sourceId), eq(leadSources.orgId, ctx.orgId)));
  if (!s) throw invalid("Origem inválida.");
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(contactTouchpoints).values({
      orgId: ctx.orgId,
      contactId,
      sourceId: s.id,
      kind: "manual",
      campaign: cleanText(input.campaign, 160),
      partner: cleanText(input.partner, 120),
      note: cleanText(input.note, 500),
      actorId: ctx.userId,
      occurredAt: now,
    });
    await tx
      .update(contacts)
      .set({ lastSourceId: s.id, lastTouchAt: now, ...(c.firstSourceId ? {} : { firstSourceId: s.id, firstTouchAt: now }) })
      .where(eq(contacts.id, contactId));
    await audit(tx, ctx, "contact.touchpoint", "contact", contactId, { source: s.name });
  });
  await publish({ orgId: ctx.orgId, topic: "contacts", entityId: contactId, ownerIds: [c.ownerId] });
  return contactJourney(ctx, contactId);
}
