/**
 * Formulários & Quizzes — lado público (sem login).
 * Tudo que define score, classificação e destino é calculado aqui, a partir das respostas validadas.
 */
import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "../db";
import {
  contactTags,
  customFields,
  dataSubjectRequests,
  leadForms,
  loginAttempts,
  memberships,
  organizations,
  quizAnswers,
  quizConsents,
  quizEvents,
  quizFormVersions,
  quizForms,
  quizScoreHistory,
  quizSubmissions,
  tags,
} from "../db/schema";
import { sha256 } from "../crypto";
import { AppError, invalid, notFound } from "../errors";
import { logger } from "../logger";
import { cleanText, notifyUser } from "./common";
import { cleanUtm, ingestLead, normalizeEmail, normalizePhone, type IngestOptions } from "./leads";
import { allQuestions, classify, computeScore, displayValue, parseInstagramOrUrl, publicDefinition, validateAnswers } from "@/lib/quiz/engine";
import { CHOICE_TYPES, PRIVACY_KIND_LABEL, type Answers, type QuizDefinition, type Route, type Tier } from "@/lib/quiz/types";

// ---------- Leitura ----------

export type PublicQuiz =
  | { status: "ok"; slug: string; formId: string; versionId: string; orgName: string; definition: ReturnType<typeof publicDefinition> }
  | { status: "unavailable"; reason: "not_found" | "unpublished" | "archived"; orgName?: string };

export async function getPublicQuiz(slug: string): Promise<PublicQuiz> {
  const s = slug.toLowerCase();
  if (!/^[a-z0-9-]{3,60}$/.test(s)) return { status: "unavailable", reason: "not_found" };
  const [row] = await db
    .select({ f: quizForms, orgName: organizations.name })
    .from(quizForms)
    .innerJoin(organizations, eq(organizations.id, quizForms.orgId))
    .where(eq(quizForms.slug, s));
  if (!row) return { status: "unavailable", reason: "not_found" };
  const f = row.f;
  if (f.status === "archived") return { status: "unavailable", reason: "archived", orgName: row.orgName };
  if (f.status !== "published" || !f.liveVersionId) return { status: "unavailable", reason: "unpublished", orgName: row.orgName };
  const [v] = await db.select().from(quizFormVersions).where(eq(quizFormVersions.id, f.liveVersionId));
  if (!v) return { status: "unavailable", reason: "unpublished", orgName: row.orgName };
  return { status: "ok", slug: f.slug, formId: f.id, versionId: v.id, orgName: row.orgName, definition: publicDefinition(v.definition) };
}

async function liveForm(slug: string) {
  const [f] = await db.select().from(quizForms).where(eq(quizForms.slug, slug.toLowerCase()));
  if (!f || f.status !== "published" || !f.liveVersionId) throw notFound("Este formulário não está disponível no momento.");
  const [v] = await db.select().from(quizFormVersions).where(eq(quizFormVersions.id, f.liveVersionId));
  if (!v) throw notFound("Este formulário não está disponível no momento.");
  return { form: f, version: v };
}

// ---------- Limites ----------

const ipKey = (ip: string | null) => sha256(`quiz-ip:${ip ?? "?"}`).slice(0, 32);

async function hitLimit(key: string, max: number, windowSql = sql`now() - interval '1 hour'`) {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.key, key), gt(loginAttempts.createdAt, windowSql)));
  if (n >= max) return true;
  await db.insert(loginAttempts).values({ key, success: true });
  return false;
}

/** Limite leve em memória para eventos de visualização (não vale um registro no banco por requisição). */
const eventBuckets = new Map<string, { start: number; n: number }>();
function eventAllowed(ip: string | null) {
  const k = ipKey(ip);
  const now = Date.now();
  const b = eventBuckets.get(k);
  if (!b || now - b.start > 3600_000) {
    eventBuckets.set(k, { start: now, n: 1 });
    if (eventBuckets.size > 5000) eventBuckets.delete(eventBuckets.keys().next().value!);
    return true;
  }
  b.n++;
  return b.n <= 400;
}

// ---------- Eventos (visualização e início) ----------

export const eventSchema = z.object({
  sessionId: z.string().uuid(),
  kind: z.enum(["view", "start"]),
  embed: z.boolean().default(false),
  utmSource: z.string().trim().max(120).optional(),
});

export async function recordEvent(slug: string, raw: unknown, ip: string | null) {
  const input = eventSchema.parse(raw);
  if (!eventAllowed(ip)) return { ok: true };
  const { form, version } = await liveForm(slug);
  await db
    .insert(quizEvents)
    .values({ orgId: form.orgId, formId: form.id, versionId: version.id, sessionId: input.sessionId, kind: input.kind, channel: input.embed ? "embed" : "link", utmSource: cleanText(input.utmSource, 120) })
    .onConflictDoNothing();
  return { ok: true };
}

// ---------- Envio ----------

export const submitSchema = z.object({
  sessionId: z.string().uuid("Sessão inválida. Recarregue a página."),
  answers: z.record(z.string().max(60), z.unknown()).default({}),
  consent: z.object({ notice: z.boolean(), marketing: z.boolean().default(false) }),
  utm: z.record(z.string().max(40), z.string().max(300)).optional(),
  referrer: z.string().max(500).optional(),
  embed: z.boolean().default(false),
  /** Campo invisível: robôs costumam preencher. */
  website: z.string().max(200).optional().default(""),
  startedAt: z.number().optional(),
});

const SUBMIT_LIMIT_PER_HOUR = 12;
const DUPLICATE_WINDOW_MIN = 10;

/** Destino do CRM a partir da rota configurada. */
export function routeToIngest(r: Route): Pick<IngestOptions, "route" | "notify"> {
  return {
    route: {
      pipelineKind: r.mode === "sales" ? "sales" : "relationship",
      stageId: r.mode === "relationship" ? r.stageId : null,
      salesStageId: r.mode === "sales" ? r.salesStageId : null,
      assignMode: r.assignMode === "fixed" ? "fixed" : "round_robin",
      fixedAssigneeId: r.assignMode === "fixed" ? r.fixedAssigneeId : null,
      assigneeIds: r.assigneeIds,
      noAssign: r.assignMode === "none",
    },
    notify: r.notify,
  };
}

/** Adiciona etiquetas ao contato sem remover as que ele já tem. */
export async function addTags(tx: DbOrTx, orgId: string, contactId: string, names: string[]) {
  const unique = [...new Map(names.map((n) => [n.trim().toLowerCase(), n.trim()])).values()].filter(Boolean);
  if (!unique.length) return;
  await tx.insert(tags).values(unique.map((name) => ({ orgId, name }))).onConflictDoNothing();
  const rows = await tx.select({ id: tags.id }).from(tags).where(and(eq(tags.orgId, orgId), inArray(sql`lower(${tags.name})`, unique.map((n) => n.toLowerCase()))));
  if (rows.length) await tx.insert(contactTags).values(rows.map((t) => ({ contactId, tagId: t.id }))).onConflictDoNothing();
}

export async function removeTags(tx: DbOrTx, orgId: string, contactId: string, names: string[]) {
  if (!names.length) return;
  const rows = await tx.select({ id: tags.id }).from(tags).where(and(eq(tags.orgId, orgId), inArray(sql`lower(${tags.name})`, names.map((n) => n.toLowerCase()))));
  if (rows.length) await tx.delete(contactTags).where(and(eq(contactTags.contactId, contactId), inArray(contactTags.tagId, rows.map((r) => r.id))));
}

/** Dados de contato e campos do CRM extraídos das respostas visíveis. */
function extractIdentity(def: QuizDefinition, answers: Answers) {
  const out = { name: null as string | null, email: null as string | null, phone: null as string | null, instagram: null as string | null, company: null as string | null, custom: {} as Record<string, string> };
  for (const q of allQuestions(def)) {
    const v = answers[q.id];
    if (v === undefined || v === null) continue;
    const text = displayValue(q, v);
    switch (q.crmField) {
      case "name":
        out.name ??= cleanText(text, 120);
        break;
      case "email":
        out.email ??= normalizeEmail(text);
        break;
      case "phone":
        out.phone ??= normalizePhone(text);
        break;
      case "instagram":
        out.instagram ??= parseInstagramOrUrl(text)?.handle ?? null;
        break;
      case "company":
        out.company ??= cleanText(text, 160);
        break;
      case "none":
        break;
      default:
        if (q.crmField.startsWith("custom:") && text) out.custom[q.crmField.slice(7)] = text.slice(0, 500);
    }
  }
  if (out.company) out.custom.empresa ??= out.company;
  return out;
}

export type Scored = { raw: number; max: number; score: number | null; tier: Tier | null; classification: ReturnType<typeof classify> | null; perQuestion: Record<string, number> };

/** Score e classificação no servidor, com as regras de uma versão. */
export function scoreWith(def: QuizDefinition, answers: Answers): Scored {
  const s = computeScore(def, answers);
  if (!def.scoring.enabled) return { raw: s.raw, max: s.max, score: null, tier: null, classification: null, perQuestion: s.perQuestion };
  const c = classify(def.scoring, s.score, answers);
  return { raw: s.raw, max: s.max, score: s.score, tier: def.scoring.tiers.find((t) => t.id === c.tierId) ?? null, classification: c, perQuestion: s.perQuestion };
}

const asList = (v: unknown) => (Array.isArray(v) ? (v as string[]) : typeof v === "string" ? [v] : []);

export async function submitQuiz(slug: string, raw: unknown, meta: { ip: string | null; userAgent: string | null }) {
  const { form, version } = await liveForm(slug);
  const def = version.definition;
  const input = submitSchema.parse(raw);
  const thanks = { ok: true, message: def.settings.completion, redirectUrl: def.settings.redirectUrl };

  // Robô: responde como se tivesse dado certo, sem registrar nada.
  if (input.website || (input.startedAt && Date.now() - input.startedAt < 3000)) return thanks;

  // Mesmo envio repetido (clique duplo, rede instável): idempotente.
  const [already] = await db.select({ id: quizSubmissions.id }).from(quizSubmissions).where(and(eq(quizSubmissions.formId, form.id), eq(quizSubmissions.sessionId, input.sessionId)));
  if (already) return thanks;

  const { answers, errors, visible } = validateAnswers(def, input.answers);
  if (!input.consent.notice) errors._consent = "Confirme que leu o aviso de privacidade para enviar.";
  if (Object.keys(errors).length) throw invalid("Confira as respostas destacadas.", { fields: errors });

  const ipHash = ipKey(meta.ip);
  if (await hitLimit(`quiz:${ipHash}`, SUBMIT_LIMIT_PER_HOUR)) throw new AppError("rate_limited", "Muitos envios seguidos deste aparelho. Tente novamente mais tarde.");

  const who = extractIdentity(def, answers);
  if (!who.phone && !who.email && !who.instagram) throw invalid("Informe um WhatsApp, e-mail ou Instagram para contato.", { fields: { _contact: "Informe um contato." } });
  const name = who.name ?? who.email ?? who.phone ?? (who.instagram ? `@${who.instagram}` : "Lead sem nome");

  const scored = scoreWith(def, answers);
  const tier = scored.tier;
  const route = tier?.route ?? def.settings.defaultRoute;
  const utm = cleanUtm(input.utm);
  const channel = input.embed ? "embed" : "link";
  const now = new Date();

  // A mesma pessoa reenviando o mesmo formulário em poucos minutos: guarda, mas não cria outro lead.
  const dupConds = [who.email ? eq(quizSubmissions.email, who.email) : undefined, who.phone ? eq(quizSubmissions.phone, who.phone) : undefined].filter(Boolean);
  const [dup] = dupConds.length
    ? await db
        .select({ id: quizSubmissions.id, leadId: quizSubmissions.leadId, contactId: quizSubmissions.contactId })
        .from(quizSubmissions)
        .where(and(eq(quizSubmissions.formId, form.id), isNull(quizSubmissions.duplicateOf), gt(quizSubmissions.completedAt, sql`now() - make_interval(mins => ${DUPLICATE_WINDOW_MIN})`), or(...dupConds)))
        .limit(1)
    : [];

  const customKeys = Object.keys(who.custom);
  const fieldRows = customKeys.length ? await db.select({ id: customFields.id, key: customFields.key }).from(customFields).where(and(eq(customFields.orgId, form.orgId), inArray(customFields.key, customKeys))) : [];
  const custom = Object.fromEntries(fieldRows.map((f) => [f.id, who.custom[f.key]]));

  const visibleQs = allQuestions(def).filter((q) => visible.has(q.id) && answers[q.id] !== undefined);
  const leadAnswers = visibleQs.map((q) => ({ label: q.title, value: displayValue(q, answers[q.id]) }));

  const recordSubmission = async (tx: DbOrTx, link: { contactId: string | null; leadId: string | null; duplicateOf: string | null }) => {
    const [sub] = await tx
      .insert(quizSubmissions)
      .values({
        orgId: form.orgId,
        formId: form.id,
        versionId: version.id,
        sessionId: input.sessionId,
        contactId: link.contactId,
        leadId: link.leadId,
        name,
        email: who.email,
        phone: who.phone,
        instagram: who.instagram,
        company: who.company,
        answers,
        rawPoints: scored.raw,
        maxPoints: scored.max,
        score: scored.score,
        tierId: tier?.id ?? null,
        tierLabel: tier?.label ?? null,
        classification: scored.classification,
        scoredWithVersionId: version.id,
        channel,
        utm,
        referrer: cleanText(input.referrer, 500),
        route: link.duplicateOf ? null : route,
        ipHash,
        userAgent: cleanText(meta.userAgent, 300),
        duplicateOf: link.duplicateOf,
        startedAt: input.startedAt ? new Date(Math.min(input.startedAt, now.getTime())) : null,
        completedAt: now,
      })
      .returning();
    if (visibleQs.length) {
      await tx.insert(quizAnswers).values(
        visibleQs.map((q) => ({
          orgId: form.orgId,
          submissionId: sub.id,
          questionKey: q.id,
          questionTitle: q.title,
          type: q.type,
          value: answers[q.id] as unknown,
          displayValue: displayValue(q, answers[q.id]),
          optionKeys: CHOICE_TYPES.includes(q.type) ? asList(answers[q.id]) : [],
          points: scored.perQuestion[q.id] ?? 0,
        })),
      );
    }
    const consent = def.settings.consent;
    const consents = [
      { kind: "processing_notice", granted: true, text: consent.noticeText },
      ...(consent.marketingEnabled ? [{ kind: "marketing", granted: input.consent.marketing, text: consent.marketingText }] : []),
      ...visibleQs.filter((q) => q.type === "consent").map((q) => ({ kind: `question:${q.id}`, granted: answers[q.id] === true, text: q.title })),
    ];
    await tx.insert(quizConsents).values(consents.map((c) => ({ orgId: form.orgId, submissionId: sub.id, contactId: link.contactId, kind: c.kind, granted: c.granted, textVersion: consent.version, text: c.text, policyUrl: consent.policyUrl })));
    await tx.insert(quizScoreHistory).values({ orgId: form.orgId, submissionId: sub.id, versionId: version.id, rawPoints: scored.raw, maxPoints: scored.max, score: scored.score, tierId: tier?.id ?? null, tierLabel: tier?.label ?? null, reason: "Cálculo no envio" });
    await tx.insert(quizEvents).values({ orgId: form.orgId, formId: form.id, versionId: version.id, sessionId: input.sessionId, kind: "complete", channel, utmSource: utm.utm_source ?? null }).onConflictDoNothing();
    return sub;
  };

  if (dup) {
    await db.transaction((tx) => recordSubmission(tx, { contactId: dup.contactId, leadId: dup.leadId, duplicateOf: dup.id }));
    logger.info("Envio repetido do formulário registrado sem novo lead", { formId: form.id });
    return thanks;
  }

  if (!form.leadFormId) throw new AppError("internal", "Formulário sem integração com o CRM. Publique novamente.");
  const [backing] = await db.select().from(leadForms).where(eq(leadForms.id, form.leadFormId));
  if (!backing) throw new AppError("internal", "Formulário sem integração com o CRM. Publique novamente.");

  let submissionId = "";
  const lead = await ingestLead(
    backing,
    { name, phone: who.phone, email: who.email, instagram: who.instagram, answers: leadAnswers, custom, productText: null, preferredAt: null, preferredText: null, utm, channel: "crmlabs_quiz" },
    {
      ...routeToIngest(route),
      touchpointNote: `Respondeu “${def.settings.title}”${channel === "embed" ? " (site)" : ""}.`,
      afterInsert: async (tx, r) => {
        const sub = await recordSubmission(tx, { contactId: r.contactId, leadId: r.lead.id, duplicateOf: null });
        submissionId = sub.id;
        await addTags(tx, form.orgId, r.contactId, [...def.settings.tags, ...(tier?.tags ?? [])]);
      },
    },
  );

  // Avisos configurados no formulário (além de quem recebeu o lead).
  const notifyIds = def.settings.notifyUserIds.filter((u) => u !== lead.assignedTo);
  if (notifyIds.length) {
    const active = await db.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.orgId, form.orgId), inArray(memberships.userId, notifyIds), eq(memberships.status, "active")));
    for (const a of active) {
      await notifyUser({
        orgId: form.orgId,
        userId: a.userId,
        type: "lead.new",
        title: `Nova resposta: ${name}`,
        body: [def.settings.title, tier?.label].filter(Boolean).join(" · "),
        link: `/formularios/${form.id}/respostas?resposta=${submissionId}`,
        dedupeKey: `quiz:${submissionId}`,
      }).catch((e) => logger.warn("Falha ao avisar sobre resposta de formulário", e));
    }
  }
  return thanks;
}

// ---------- Pedidos de titulares (LGPD) ----------

export const privacyRequestSchema = z.object({
  form: z.string().trim().toLowerCase().max(60).optional(),
  kind: z.enum(["access", "correction", "deletion", "revoke_marketing", "other"]),
  name: z.string().trim().min(2, "Informe seu nome.").max(120),
  email: z.string().trim().max(200).optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
  message: z.string().trim().max(2000).optional().default(""),
  website: z.string().max(200).optional().default(""),
});


export async function submitPrivacyRequest(raw: unknown, ip: string | null) {
  const input = privacyRequestSchema.parse(raw);
  const ok = { ok: true, message: "Pedido recebido. A equipe responsável vai responder pelo contato informado." };
  if (input.website) return ok;
  const email = input.email ? normalizeEmail(input.email) : null;
  const phone = input.phone ? normalizePhone(input.phone) : null;
  if (!email && !phone) throw invalid("Informe um e-mail ou telefone para respondermos.", { fields: { email: "Informe um e-mail ou telefone." } });
  if (await hitLimit(`dsr:${ipKey(ip)}`, 5)) throw new AppError("rate_limited", "Muitos pedidos seguidos. Tente novamente mais tarde.");
  let orgId: string | null = null;
  if (input.form) {
    const [f] = await db.select({ orgId: quizForms.orgId }).from(quizForms).where(eq(quizForms.slug, input.form));
    orgId = f?.orgId ?? null;
  }
  if (!orgId) {
    const [o] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.isDemo, false)).orderBy(organizations.createdAt).limit(1);
    orgId = o?.id ?? null;
  }
  if (!orgId) return ok;
  const [r] = await db.insert(dataSubjectRequests).values({ orgId, kind: input.kind, name: input.name, email, phone, message: cleanText(input.message, 2000) }).returning();
  const admins = await db.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.role, "admin"), eq(memberships.status, "active")));
  for (const a of admins) {
    await notifyUser({ orgId, userId: a.userId, type: "privacy.request", title: `Pedido de titular (LGPD): ${PRIVACY_KIND_LABEL[input.kind]}`, body: `${input.name} · ${email ?? phone}`, link: `/formularios?aba=privacidade`, dedupeKey: `dsr:${r.id}` }).catch(() => {});
  }
  return ok;
}
