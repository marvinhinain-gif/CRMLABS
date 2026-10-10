/**
 * Formulários & Quizzes — respostas, indicadores, exportação, recálculo de score
 * e a aba "Formulários respondidos" do contato.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { TZDate } from "@date-fns/tz";
import { db } from "../db";
import { contacts, leads, quizAnswers, quizConsents, quizEvents, quizFormVersions, quizForms, quizScoreHistory, quizSubmissions, users, dataSubjectRequests } from "../db/schema";
import type { Ctx } from "../context";
import { AppError, forbidden, invalid, notFound } from "../errors";
import { can, contactScope } from "../permissions";
import { publish } from "../realtime";
import { audit } from "./common";
import { assertForms, originLabel } from "./quizzes";
import { addTags, removeTags, scoreWith } from "./quizPublic";
import { buildCsv, buildXlsx, type Cell } from "../xlsx";
import { allQuestions, displayValue } from "@/lib/quiz/engine";
import { CHOICE_TYPES, type QuizDefinition } from "@/lib/quiz/types";

async function ownForm(ctx: Ctx, id: string) {
  assertForms(ctx);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Formulário não encontrado.");
  const [f] = await db.select().from(quizForms).where(and(eq(quizForms.id, id), eq(quizForms.orgId, ctx.orgId)));
  if (!f) throw notFound("Formulário não encontrado.");
  return f;
}

// ---------- Filtros ----------

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const responseFilterSchema = z.object({
  from: day.optional(),
  to: day.optional(),
  scoreMin: z.coerce.number().int().min(0).max(1000).optional(),
  scoreMax: z.coerce.number().int().min(0).max(1000).optional(),
  tier: z.string().max(60).optional(),
  origin: z.string().max(120).optional(),
  assignedTo: z.string().uuid().optional(),
  status: z.enum(["new", "contacted", "scheduled", "no_answer", "disqualified"]).optional(),
  q: z.string().trim().max(100).optional(),
  duplicates: z.enum(["hide", "show"]).default("hide"),
});
export type ResponseFilter = z.infer<typeof responseFilterSchema>;

const dayStart = (d: string, tz: string) => {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(new TZDate(y, m - 1, dd, 0, 0, 0, tz).getTime());
};

const originSql = sql<string>`coalesce(nullif(${quizSubmissions.utm}->>'utm_source', ''), case when ${quizSubmissions.channel} = 'embed' then 'Site (incorporado)' else 'Link direto' end)`;

function filterConds(ctx: Ctx, formId: string, f: ResponseFilter): SQL[] {
  const conds: SQL[] = [eq(quizSubmissions.orgId, ctx.orgId), eq(quizSubmissions.formId, formId)];
  if (f.duplicates === "hide") conds.push(isNull(quizSubmissions.duplicateOf));
  if (f.from) conds.push(gte(quizSubmissions.completedAt, dayStart(f.from, ctx.org.timezone)));
  if (f.to) conds.push(lt(quizSubmissions.completedAt, new Date(dayStart(f.to, ctx.org.timezone).getTime() + 86400000)));
  if (f.scoreMin !== undefined) conds.push(gte(quizSubmissions.score, f.scoreMin));
  if (f.scoreMax !== undefined) conds.push(lte(quizSubmissions.score, f.scoreMax));
  if (f.tier) conds.push(f.tier === "none" ? isNull(quizSubmissions.tierId) : eq(quizSubmissions.tierId, f.tier));
  if (f.origin) conds.push(sql`${originSql} = ${f.origin}`);
  if (f.assignedTo) conds.push(eq(leads.assignedTo, f.assignedTo));
  if (f.status) conds.push(eq(leads.status, f.status));
  if (f.q) {
    const like = `%${f.q.replace(/[%_]/g, "")}%`;
    conds.push(sql`(${quizSubmissions.name} ilike ${like} or ${quizSubmissions.email} ilike ${like} or ${quizSubmissions.phone} ilike ${like} or ${quizSubmissions.instagram} ilike ${like} or ${quizSubmissions.company} ilike ${like})`);
  }
  return conds;
}

const baseSelect = {
  id: quizSubmissions.id,
  name: quizSubmissions.name,
  email: quizSubmissions.email,
  phone: quizSubmissions.phone,
  instagram: quizSubmissions.instagram,
  company: quizSubmissions.company,
  score: quizSubmissions.score,
  rawPoints: quizSubmissions.rawPoints,
  maxPoints: quizSubmissions.maxPoints,
  tierId: quizSubmissions.tierId,
  tierLabel: quizSubmissions.tierLabel,
  channel: quizSubmissions.channel,
  utm: quizSubmissions.utm,
  origin: originSql,
  completedAt: quizSubmissions.completedAt,
  versionId: quizSubmissions.versionId,
  contactId: quizSubmissions.contactId,
  leadId: quizSubmissions.leadId,
  duplicateOf: quizSubmissions.duplicateOf,
  anonymizedAt: quizSubmissions.anonymizedAt,
  leadStatus: leads.status,
  assignedTo: leads.assignedTo,
  assignedName: users.name,
};

const PAGE = 25;

export async function listResponses(ctx: Ctx, formId: string, f: ResponseFilter & { page?: number }) {
  const form = await ownForm(ctx, formId);
  const where = and(...filterConds(ctx, form.id, f));
  const page = Math.max(1, f.page ?? 1);
  const rows = await db
    .select(baseSelect)
    .from(quizSubmissions)
    .leftJoin(leads, eq(leads.id, quizSubmissions.leadId))
    .leftJoin(users, eq(users.id, leads.assignedTo))
    .where(where)
    .orderBy(desc(quizSubmissions.completedAt))
    .limit(PAGE)
    .offset((page - 1) * PAGE);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(quizSubmissions).leftJoin(leads, eq(leads.id, quizSubmissions.leadId)).where(where);
  return { rows, total, page, pageSize: PAGE };
}

/** Faixas, origens e responsáveis presentes (para os filtros). */
export async function responseFilterOptions(ctx: Ctx, formId: string) {
  const form = await ownForm(ctx, formId);
  const tiers = await db
    .selectDistinct({ id: quizSubmissions.tierId, label: quizSubmissions.tierLabel })
    .from(quizSubmissions)
    .where(and(eq(quizSubmissions.formId, form.id), sql`${quizSubmissions.tierId} is not null`));
  const origins = await db.selectDistinct({ origin: originSql }).from(quizSubmissions).where(eq(quizSubmissions.formId, form.id));
  const people = await db
    .selectDistinct({ id: users.id, name: users.name })
    .from(quizSubmissions)
    .innerJoin(leads, eq(leads.id, quizSubmissions.leadId))
    .innerJoin(users, eq(users.id, leads.assignedTo))
    .where(eq(quizSubmissions.formId, form.id));
  const draftTiers = form.draft.scoring.tiers.map((t) => ({ id: t.id, label: t.label, color: t.color }));
  const seen = tiers.filter((t): t is { id: string; label: string } => !!t.id && !!t.label).map((t) => ({ ...t, color: "gray" }));
  const merged = [...new Map([...seen, ...draftTiers].map((t) => [t.id, t])).values()];
  return { tiers: merged, origins: origins.map((o) => o.origin).sort(), people };
}

// ---------- Resposta individual ----------

export async function getSubmission(ctx: Ctx, submissionId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(submissionId)) throw notFound("Resposta não encontrada.");
  const [s] = await db
    .select({ s: quizSubmissions, formName: quizForms.name, formTitle: sql<string>`${quizForms.draft}->'settings'->>'title'`, contactOwner: contacts.ownerId })
    .from(quizSubmissions)
    .innerJoin(quizForms, eq(quizForms.id, quizSubmissions.formId))
    .leftJoin(contacts, eq(contacts.id, quizSubmissions.contactId))
    .where(and(eq(quizSubmissions.id, submissionId), eq(quizSubmissions.orgId, ctx.orgId)));
  if (!s) throw notFound("Resposta não encontrada.");
  // Gestores veem tudo; demais, só respostas de contatos que já podem ver.
  if (!can(ctx, "forms.manage")) {
    if (!s.s.contactId) throw notFound("Resposta não encontrada.");
    const [visible] = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, s.s.contactId), contactScope(ctx)));
    if (!visible) throw notFound("Resposta não encontrada.");
  }
  const [v] = await db.select().from(quizFormVersions).where(eq(quizFormVersions.id, s.s.versionId));
  const def = v.definition;
  const answerRows = await db.select().from(quizAnswers).where(eq(quizAnswers.submissionId, s.s.id));
  const sections = def.sections
    .map((sec) => ({
      title: sec.title,
      answers: sec.questions
        .map((q) => {
          const a = answerRows.find((r) => r.questionKey === q.id);
          if (!a) return null;
          return { questionId: q.id, title: q.title, type: q.type, value: a.displayValue ?? "", points: q.scored ? a.points : null, maxPoints: q.scored ? Math.max(0, ...(q.options ?? []).map((o) => o.points)) : null };
        })
        .filter((x): x is NonNullable<typeof x> => !!x),
    }))
    .filter((x) => x.answers.length);
  const consents = await db.select({ kind: quizConsents.kind, granted: quizConsents.granted, textVersion: quizConsents.textVersion, text: quizConsents.text, createdAt: quizConsents.createdAt }).from(quizConsents).where(eq(quizConsents.submissionId, s.s.id));
  const history = await db
    .select({ id: quizScoreHistory.id, score: quizScoreHistory.score, rawPoints: quizScoreHistory.rawPoints, maxPoints: quizScoreHistory.maxPoints, tierLabel: quizScoreHistory.tierLabel, reason: quizScoreHistory.reason, createdAt: quizScoreHistory.createdAt, actorName: users.name, version: quizFormVersions.version })
    .from(quizScoreHistory)
    .leftJoin(users, eq(users.id, quizScoreHistory.actorId))
    .leftJoin(quizFormVersions, eq(quizFormVersions.id, quizScoreHistory.versionId))
    .where(eq(quizScoreHistory.submissionId, s.s.id))
    .orderBy(asc(quizScoreHistory.createdAt));
  const [lead] = s.s.leadId ? await db.select({ id: leads.id, status: leads.status, assignedName: users.name }).from(leads).leftJoin(users, eq(users.id, leads.assignedTo)).where(eq(leads.id, s.s.leadId)) : [];
  const cls = s.s.classification as { path?: { tierId: string; failed: string[] }[]; scoreTierId?: string } | null;
  const tierName = (id: string) => def.scoring.tiers.find((t) => t.id === id)?.label ?? id;
  return {
    id: s.s.id,
    formId: s.s.formId,
    formName: s.formName,
    formTitle: def.settings.title,
    version: v.version,
    name: s.s.name,
    email: s.s.email,
    phone: s.s.phone,
    instagram: s.s.instagram,
    company: s.s.company,
    score: s.s.score,
    rawPoints: s.s.rawPoints,
    maxPoints: s.s.maxPoints,
    tierId: s.s.tierId,
    tierLabel: s.s.tierLabel,
    tierColor: def.scoring.tiers.find((t) => t.id === s.s.tierId)?.color ?? "gray",
    scoreTierLabel: cls?.scoreTierId ? tierName(cls.scoreTierId) : null,
    demotions: (cls?.path ?? []).filter((p) => p.failed.length).map((p) => ({ tier: tierName(p.tierId), failed: p.failed })),
    channel: s.s.channel,
    origin: originLabel(s.s.channel, s.s.utm.utm_source),
    utm: s.s.utm,
    referrer: s.s.referrer,
    completedAt: s.s.completedAt,
    startedAt: s.s.startedAt,
    contactId: s.s.contactId,
    lead: lead ?? null,
    duplicateOf: s.s.duplicateOf,
    anonymizedAt: s.s.anonymizedAt,
    route: s.s.route,
    sections,
    consents,
    history,
  };
}

// ---------- Indicadores ----------

export async function formAnalytics(ctx: Ctx, formId: string, f: ResponseFilter) {
  const form = await ownForm(ctx, formId);
  const conds = filterConds(ctx, form.id, f);
  const subs = await db
    .select({ id: quizSubmissions.id, score: quizSubmissions.score, tierId: quizSubmissions.tierId, tierLabel: quizSubmissions.tierLabel, origin: originSql, completedAt: quizSubmissions.completedAt })
    .from(quizSubmissions)
    .leftJoin(leads, eq(leads.id, quizSubmissions.leadId))
    .where(and(...conds))
    .limit(50000);
  const evConds: SQL[] = [eq(quizEvents.formId, form.id)];
  if (f.from) evConds.push(gte(quizEvents.createdAt, dayStart(f.from, ctx.org.timezone)));
  if (f.to) evConds.push(lt(quizEvents.createdAt, new Date(dayStart(f.to, ctx.org.timezone).getTime() + 86400000)));
  const [ev] = await db
    .select({ views: sql<number>`count(*) filter (where ${quizEvents.kind} = 'view')::int`, starts: sql<number>`count(*) filter (where ${quizEvents.kind} = 'start')::int` })
    .from(quizEvents)
    .where(and(...evConds));
  const def = form.draft;
  const tiers = def.scoring.tiers;
  const scored = subs.filter((s) => s.score !== null);
  const ids = subs.map((s) => s.id);
  // Distribuição das respostas das perguntas de alternativas (pela chave estável, entre versões).
  const dist = ids.length
    ? await db
        .select({ key: quizAnswers.questionKey, option: sql<string>`unnest(${quizAnswers.optionKeys})`, n: sql<number>`count(*)::int` })
        .from(quizAnswers)
        .where(inArray(quizAnswers.submissionId, ids))
        .groupBy(quizAnswers.questionKey, sql`2`)
    : [];
  const questions = allQuestions(def)
    .filter((q) => CHOICE_TYPES.includes(q.type))
    .map((q) => ({
      id: q.id,
      title: q.title,
      crmField: q.crmField,
      options: (q.options ?? []).map((o) => ({ id: o.id, label: o.label, count: dist.find((d) => d.key === q.id && d.option === o.id)?.n ?? 0 })),
    }));
  const tz = ctx.org.timezone;
  const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const byDay = new Map<string, number>();
  for (const s of subs) byDay.set(dayKey(s.completedAt), (byDay.get(dayKey(s.completedAt)) ?? 0) + 1);
  const first = f.from ? dayStart(f.from, tz) : subs.length ? subs.reduce((a, s) => (s.completedAt < a ? s.completedAt : a), new Date()) : new Date(Date.now() - 29 * 86400000);
  const last = f.to ? dayStart(f.to, tz) : new Date();
  const span = Math.min(366, Math.max(1, Math.round((last.getTime() - first.getTime()) / 86400000) + 1));
  const series = Array.from({ length: Math.max(span, 7) }, (_, i) => {
    const k = dayKey(new Date(last.getTime() - (Math.max(span, 7) - 1 - i) * 86400000));
    return { day: k, count: byDay.get(k) ?? 0 };
  });
  const byOrigin = new Map<string, number>();
  for (const s of subs) byOrigin.set(s.origin, (byOrigin.get(s.origin) ?? 0) + 1);
  const completed = subs.length;
  const views = ev?.views ?? 0;
  const starts = ev?.starts ?? 0;
  return {
    views,
    starts,
    completed,
    completionRate: starts ? Math.min(1, completed / starts) : 0,
    conversionRate: views ? Math.min(1, completed / views) : 0,
    avgScore: scored.length ? Math.round(scored.reduce((a, s) => a + (s.score ?? 0), 0) / scored.length) : null,
    tiers: [
      ...tiers.map((t) => ({ id: t.id, label: t.label, color: t.color, qualified: t.qualified, count: subs.filter((s) => s.tierId === t.id).length })),
      ...[...new Set(subs.filter((s) => s.tierId && !tiers.some((t) => t.id === s.tierId)).map((s) => s.tierId!))].map((id) => ({ id, label: subs.find((s) => s.tierId === id)?.tierLabel ?? id, color: "gray", qualified: false, count: subs.filter((s) => s.tierId === id).length })),
    ],
    qualified: subs.filter((s) => tiers.some((t) => t.id === s.tierId && t.qualified)).length,
    questions,
    origins: [...byOrigin.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    series,
  };
}

// ---------- Exportação ----------

const STATUS_LABEL: Record<string, string> = { new: "Novo", contacted: "Contatado", scheduled: "Agendado", no_answer: "Sem resposta", disqualified: "Desqualificado" };

export async function exportResponses(ctx: Ctx, formId: string, f: ResponseFilter, format: "csv" | "xlsx") {
  const form = await ownForm(ctx, formId);
  const rows = await db
    .select({ ...baseSelect, answers: quizSubmissions.answers })
    .from(quizSubmissions)
    .leftJoin(leads, eq(leads.id, quizSubmissions.leadId))
    .leftJoin(users, eq(users.id, leads.assignedTo))
    .where(and(...filterConds(ctx, form.id, f)))
    .orderBy(desc(quizSubmissions.completedAt))
    .limit(20000);
  const versionIds = [...new Set(rows.map((r) => r.versionId))];
  const versions = versionIds.length ? await db.select({ id: quizFormVersions.id, version: quizFormVersions.version, definition: quizFormVersions.definition }).from(quizFormVersions).where(inArray(quizFormVersions.id, versionIds)) : [];
  // Colunas: perguntas da versão mais recente + as que só existiam em versões antigas.
  const ordered = [...versions].sort((a, b) => b.version - a.version);
  const columns = new Map<string, { title: string }>();
  for (const v of [{ definition: form.draft }, ...ordered]) for (const q of allQuestions(v.definition)) if (!columns.has(q.id)) columns.set(q.id, { title: q.title });
  const fmt = new Intl.DateTimeFormat("pt-BR", { timeZone: ctx.org.timezone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const header = ["Data", "Nome", "E-mail", "WhatsApp", "Instagram", "Empresa", "Score", "Classificação", "Origem", "Canal", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "Responsável", "Status comercial", "Versão", ...[...columns.values()].map((c) => c.title)];
  const data: Cell[][] = rows.map((r) => {
    const v = versions.find((x) => x.id === r.versionId);
    const qs = v ? allQuestions(v.definition) : [];
    return [
      fmt.format(r.completedAt),
      r.name,
      r.email,
      r.phone,
      r.instagram ? `@${r.instagram}` : "",
      r.company,
      r.score,
      r.tierLabel,
      r.origin,
      r.channel === "embed" ? "Incorporado" : "Link",
      r.utm.utm_source,
      r.utm.utm_medium,
      r.utm.utm_campaign,
      r.utm.utm_content,
      r.utm.utm_term,
      r.assignedName,
      r.leadStatus ? STATUS_LABEL[r.leadStatus] : r.duplicateOf ? "Envio repetido" : "",
      v?.version ?? "",
      ...[...columns.keys()].map((qid) => {
        const q = qs.find((x) => x.id === qid);
        return q ? displayValue(q, r.answers[qid]) : "";
      }),
    ];
  });
  await audit(db, ctx, "form.exported", "quiz_form", form.id, { format, rows: data.length });
  const base = `${form.slug}-respostas-${new Date().toISOString().slice(0, 10)}`;
  if (format === "csv") return { filename: `${base}.csv`, type: "text/csv; charset=utf-8", body: Buffer.from(buildCsv(header, data), "utf8") };
  return { filename: `${base}.xlsx`, type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", body: buildXlsx("Respostas", header, data) };
}

// ---------- Recálculo explícito ----------

export const recalcSchema = z.object({ submissionIds: z.array(z.string().uuid()).max(5000).optional() });

/**
 * Recalcula score e classificação com as regras da última versão publicada.
 * O cálculo original continua no histórico; etiquetas de faixa do contato acompanham a nova classificação.
 * O lead não muda de funil (redistribuir é decisão comercial).
 */
export async function recalculate(ctx: Ctx, formId: string, input: z.infer<typeof recalcSchema>) {
  const form = await ownForm(ctx, formId);
  if (!form.latestVersionId) throw invalid("Publique o formulário antes de recalcular.");
  const [v] = await db.select().from(quizFormVersions).where(eq(quizFormVersions.id, form.latestVersionId));
  const def: QuizDefinition = v.definition;
  if (!def.scoring.enabled) throw invalid("O Lead Score está desligado na versão publicada.");
  const conds: SQL[] = [eq(quizSubmissions.formId, form.id), isNull(quizSubmissions.anonymizedAt)];
  if (input.submissionIds?.length) conds.push(inArray(quizSubmissions.id, input.submissionIds));
  const subs = await db.select().from(quizSubmissions).where(and(...conds)).limit(5000);
  const prevVersions = await db.select({ id: quizFormVersions.id, definition: quizFormVersions.definition }).from(quizFormVersions).where(eq(quizFormVersions.formId, form.id));
  let changed = 0;
  await db.transaction(async (tx) => {
    for (const s of subs) {
      const r = scoreWith(def, s.answers);
      const tier = r.tier;
      await tx.insert(quizScoreHistory).values({ orgId: ctx.orgId, submissionId: s.id, versionId: v.id, rawPoints: r.raw, maxPoints: r.max, score: r.score, tierId: tier?.id ?? null, tierLabel: tier?.label ?? null, reason: `Recálculo com as regras da versão ${v.version}`, actorId: ctx.userId });
      if (r.score !== s.score || (tier?.id ?? null) !== s.tierId) changed++;
      await tx.update(quizSubmissions).set({ rawPoints: r.raw, maxPoints: r.max, score: r.score, tierId: tier?.id ?? null, tierLabel: tier?.label ?? null, classification: r.classification, scoredWithVersionId: v.id }).where(eq(quizSubmissions.id, s.id));
      if (s.contactId && !s.duplicateOf && (tier?.id ?? null) !== s.tierId) {
        const oldDef = prevVersions.find((p) => p.id === s.scoredWithVersionId)?.definition ?? def;
        const oldTags = oldDef.scoring.tiers.find((t) => t.id === s.tierId)?.tags ?? [];
        const newTags = tier?.tags ?? [];
        await removeTags(tx, ctx.orgId, s.contactId, oldTags.filter((t) => !newTags.includes(t)));
        await addTags(tx, ctx.orgId, s.contactId, newTags);
      }
    }
    await audit(tx, ctx, "form.recalculated", "quiz_form", form.id, { version: v.version, submissions: subs.length, changed });
  });
  await publish({ orgId: ctx.orgId, topic: "contacts" });
  return { version: v.version, recalculated: subs.length, changed };
}

// ---------- Contato: formulários respondidos ----------

export async function contactSubmissions(ctx: Ctx, contactId: string) {
  const [c] = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, contactId), contactScope(ctx)));
  if (!c) throw notFound("Contato não encontrado.");
  const rows = await db
    .select({
      id: quizSubmissions.id,
      formId: quizSubmissions.formId,
      formTitle: sql<string>`${quizFormVersions.definition}->'settings'->>'title'`,
      version: quizFormVersions.version,
      score: quizSubmissions.score,
      tierId: quizSubmissions.tierId,
      tierLabel: quizSubmissions.tierLabel,
      tierColor: sql<string | null>`(select t->>'color' from jsonb_array_elements(${quizFormVersions.definition}->'scoring'->'tiers') t where t->>'id' = ${quizSubmissions.tierId} limit 1)`,
      completedAt: quizSubmissions.completedAt,
      channel: quizSubmissions.channel,
      origin: originSql,
      duplicateOf: quizSubmissions.duplicateOf,
      anonymizedAt: quizSubmissions.anonymizedAt,
      historyCount: sql<number>`(select count(*)::int from ${quizScoreHistory} h where h.submission_id = ${sql.raw('"quiz_submissions"."id"')})`,
    })
    .from(quizSubmissions)
    .innerJoin(quizFormVersions, eq(quizFormVersions.id, quizSubmissions.versionId))
    .where(and(eq(quizSubmissions.contactId, c.id), eq(quizSubmissions.orgId, ctx.orgId)))
    .orderBy(desc(quizSubmissions.completedAt))
    .limit(50);
  return rows;
}

/** LGPD: dados do titular reunidos (respostas, consentimentos, histórico). Só administradores. */
export async function exportContactData(ctx: Ctx, contactId: string) {
  if (ctx.role !== "admin") throw forbidden("Somente administradores atendem pedidos de titulares.");
  const [c] = await db.select().from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.orgId, ctx.orgId)));
  if (!c) throw notFound("Contato não encontrado.");
  const subs = await db.select({ id: quizSubmissions.id }).from(quizSubmissions).where(eq(quizSubmissions.contactId, c.id));
  const details = [];
  for (const s of subs) details.push(await getSubmission(ctx, s.id));
  await audit(db, ctx, "privacy.export", "contact", c.id, { submissions: subs.length });
  return { contact: { name: c.name, email: c.email, phone: c.phone, instagram: c.username, createdAt: c.createdAt }, submissions: details, generatedAt: new Date() };
}

/**
 * LGPD: anonimiza as respostas de formulário de um contato (pedido do titular).
 * Ação individual e explícita do administrador; score e classificação ficam para estatística.
 */
export async function anonymizeContactSubmissions(ctx: Ctx, contactId: string) {
  if (ctx.role !== "admin") throw forbidden("Somente administradores atendem pedidos de titulares.");
  const [c] = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.orgId, ctx.orgId)));
  if (!c) throw notFound("Contato não encontrado.");
  const subs = await db.select({ id: quizSubmissions.id }).from(quizSubmissions).where(and(eq(quizSubmissions.contactId, c.id), isNull(quizSubmissions.anonymizedAt)));
  if (!subs.length) throw new AppError("conflict", "Não há respostas para anonimizar.");
  const ids = subs.map((s) => s.id);
  await db.transaction(async (tx) => {
    await tx.update(quizSubmissions).set({ name: "Titular anonimizado", email: null, phone: null, instagram: null, company: null, answers: {}, referrer: null, ipHash: null, userAgent: null, anonymizedAt: new Date() }).where(inArray(quizSubmissions.id, ids));
    const leadIds = (await tx.select({ id: quizSubmissions.leadId }).from(quizSubmissions).where(inArray(quizSubmissions.id, ids))).map((r) => r.id).filter((x): x is string => !!x);
    if (leadIds.length) await tx.update(leads).set({ answers: [], custom: {}, utm: {} }).where(inArray(leads.id, leadIds));
    await tx.update(quizAnswers).set({ value: null, displayValue: "[anonimizado]" }).where(and(inArray(quizAnswers.submissionId, ids), sql`${quizAnswers.type} in ('short_text','long_text','email','phone','url','date')`));
    await audit(tx, ctx, "privacy.anonymized", "contact", c.id, { submissions: ids.length });
  });
  return { anonymized: ids.length };
}

export async function listPrivacyRequests(ctx: Ctx) {
  if (ctx.role !== "admin") throw forbidden("Somente administradores atendem pedidos de titulares.");
  return db.select().from(dataSubjectRequests).where(eq(dataSubjectRequests.orgId, ctx.orgId)).orderBy(desc(dataSubjectRequests.createdAt)).limit(100);
}

export async function resolvePrivacyRequest(ctx: Ctx, id: string) {
  if (ctx.role !== "admin") throw forbidden("Somente administradores atendem pedidos de titulares.");
  const [r] = await db.update(dataSubjectRequests).set({ status: "done", resolvedBy: ctx.userId, resolvedAt: new Date() }).where(and(eq(dataSubjectRequests.id, id), eq(dataSubjectRequests.orgId, ctx.orgId))).returning();
  if (!r) throw notFound("Pedido não encontrado.");
  await audit(db, ctx, "privacy.request_resolved", "data_subject_request", r.id);
  return r;
}
