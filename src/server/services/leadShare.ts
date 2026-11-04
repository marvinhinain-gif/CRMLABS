import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import { customFields, leadForms, leadSources, leads, organizations, products, quizForms, quizSubmissions } from "../db/schema";
import type { Ctx } from "../context";
import { notFound } from "../errors";
import { leadScope } from "../permissions";
import { appUrl } from "../env";
import { randomToken } from "../crypto";
import { audit } from "./common";
import { leadScoreOf } from "./leads";
import { LEAD_CLASS, type LeadClass } from "@/lib/leadScore";

/**
 * Ficha do lead por link: qualquer pessoa com o link vê, sem login, os dados de contato e as respostas do
 * formulário/quiz. Só leitura. O token é aleatório (32 bytes) e o link pode ser desativado a qualquer momento;
 * ao criar de novo, sai um link novo e o antigo para de funcionar.
 */

const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;

export const shareUrlFor = (token: string | null) => (token ? `${appUrl()}/ficha/${token}` : null);

async function visibleLead(ctx: Ctx, id: string) {
  const [l] = await db.select({ id: leads.id, shareToken: leads.shareToken, sharedAt: leads.sharedAt }).from(leads).where(and(eq(leads.id, id), leadScope(ctx, "edit")));
  // Closer só compartilha os leads que chegaram a ele (os demais ele apenas acompanha).
  if (!l) throw notFound("Lead não encontrado.");
  return l;
}

/** Cria o link da ficha (ou devolve o que já existe). Quem vê o lead pode compartilhar. */
export async function shareLead(ctx: Ctx, id: string) {
  const l = await visibleLead(ctx, id);
  if (l.shareToken) return { url: shareUrlFor(l.shareToken)!, sharedAt: l.sharedAt };
  const token = randomToken(32);
  const [u] = await db
    .update(leads)
    .set({ shareToken: token, sharedAt: new Date(), sharedBy: ctx.userId })
    .where(and(eq(leads.id, l.id), isNull(leads.shareToken)))
    .returning({ shareToken: leads.shareToken, sharedAt: leads.sharedAt });
  if (!u) {
    // Outra pessoa criou o link ao mesmo tempo: usa o dela.
    const again = await visibleLead(ctx, id);
    return { url: shareUrlFor(again.shareToken)!, sharedAt: again.sharedAt };
  }
  await audit(db, ctx, "lead.shared", "lead", l.id, {});
  return { url: shareUrlFor(u.shareToken)!, sharedAt: u.sharedAt };
}

/** Desativa o link: quem tiver o endereço antigo passa a ver "link desativado". */
export async function unshareLead(ctx: Ctx, id: string) {
  const l = await visibleLead(ctx, id);
  if (!l.shareToken) return { url: null };
  await db.update(leads).set({ shareToken: null, sharedAt: null, sharedBy: null }).where(eq(leads.id, l.id));
  await audit(db, ctx, "lead.unshared", "lead", l.id, {});
  return { url: null };
}

export type SharedLead = {
  orgName: string;
  name: string;
  phone: string | null;
  email: string | null;
  instagram: string | null;
  formName: string | null;
  createdAt: Date;
  sourceName: string | null;
  productName: string | null;
  customValues: { label: string; value: string }[];
  answers: { label: string; value: string }[];
  preferredAt: Date | null;
  preferredText: string | null;
  leadScore: { label: string; score: number | null; tierLabel: string | null; productLabel: string | null; quizTitle: string | null } | null;
  quiz: { title: string; completedAt: Date; answers: { label: string; value: string }[] } | null;
};

/** Dados da ficha para a página pública. null = link inexistente ou desativado. */
export async function getSharedLead(token: string): Promise<SharedLead | null> {
  if (!TOKEN_RE.test(token)) return null;
  const [l] = await db.select().from(leads).where(eq(leads.shareToken, token));
  if (!l) return null;
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, l.orgId));
  const [form] = l.formId ? await db.select({ name: leadForms.name }).from(leadForms).where(eq(leadForms.id, l.formId)) : [];
  const [src] = l.sourceId ? await db.select({ name: leadSources.name }).from(leadSources).where(eq(leadSources.id, l.sourceId)) : [];
  const [prod] = l.productId ? await db.select({ name: products.name }).from(products).where(eq(products.id, l.productId)) : [];
  const fieldIds = Object.keys(l.custom ?? {});
  const fieldRows = fieldIds.length
    ? await db.select({ id: customFields.id, label: customFields.label }).from(customFields).where(and(eq(customFields.orgId, l.orgId), inArray(customFields.id, fieldIds))).orderBy(asc(customFields.position))
    : [];
  const s = await leadScoreOf(l);
  const app = s.application;
  // Lead que veio de outro formulário mas também respondeu o quiz de aplicação: mostra as respostas do quiz também.
  let quiz: SharedLead["quiz"] = null;
  if (app) {
    const [sub] = await db
      .select({ title: quizForms.name, completedAt: quizSubmissions.completedAt, answers: leads.answers })
      .from(quizSubmissions)
      .innerJoin(quizForms, eq(quizForms.id, quizSubmissions.formId))
      .innerJoin(leads, eq(leads.id, quizSubmissions.leadId))
      .where(and(eq(quizSubmissions.id, app.id), eq(quizSubmissions.orgId, l.orgId)));
    if (sub && sub.answers.length && quizSubmissionLeadDiffers(sub.answers, l.answers)) quiz = { title: sub.title, completedAt: sub.completedAt, answers: sub.answers };
  }
  const cls = s.class as LeadClass | null;
  return {
    orgName: org?.name ?? "",
    name: l.name,
    phone: l.phone,
    email: l.email,
    instagram: l.instagram,
    formName: form?.name ?? null,
    createdAt: l.createdAt,
    sourceName: src?.name ?? null,
    productName: prod?.name ?? null,
    customValues: fieldRows.map((f) => ({ label: f.label, value: l.custom[f.id] })),
    answers: l.answers,
    preferredAt: l.preferredAt,
    preferredText: l.preferredText,
    leadScore: cls || app ? { label: cls ? LEAD_CLASS[cls].label : "A classificar", score: app?.score ?? null, tierLabel: app?.tierLabel ?? null, productLabel: app?.productLabel ?? null, quizTitle: app?.formTitle ?? null } : null,
    quiz,
  };
}

/** O quiz só aparece à parte quando as respostas dele não são as mesmas já mostradas na ficha. */
function quizSubmissionLeadDiffers(a: { label: string; value: string }[], b: { label: string; value: string }[]) {
  return JSON.stringify(a) !== JSON.stringify(b);
}
