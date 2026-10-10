/**
 * Formulários & Quizzes — configuração (administradores e gestores).
 * O rascunho é livre para editar; o público só vê versões publicadas e congeladas.
 * Publicar é atômico: versão, perguntas, regras e o ponteiro "no ar" mudam numa única transação.
 */
import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "../db";
import {
  auditEvents,
  customFields,
  leadForms,
  leadSources,
  memberships,
  pipelineStages,
  products,
  quizAssets,
  quizEvents,
  quizFormVersions,
  quizForms,
  quizOptions,
  quizPublications,
  quizQuestions,
  quizScoringRules,
  quizSections,
  quizSubmissions,
  users,
} from "../db/schema";
import type { Ctx } from "../context";
import { encryptSecret, randomToken, sha256 } from "../crypto";
import { appUrl } from "../env";
import { AppError, invalid, notFound } from "../errors";
import { assertCan } from "../permissions";
import { logger } from "../logger";
import { audit, getPipeline } from "./common";
import { QUIZ_PROVIDER } from "./leads";
import { sniffImage } from "./avatars";
import { definitionSchema } from "@/lib/quiz/schema";
import { allQuestions, maxPoints, publishProblems } from "@/lib/quiz/engine";
import { AXION_TEMPLATE_KEY, axionDefinition, blankDefinition } from "@/lib/quiz/templates";
import type { QuizDefinition, Route } from "@/lib/quiz/types";

const NO_ACCESS = "Somente administradores e gestores gerenciam formulários.";
export const assertForms = (ctx: Ctx) => assertCan(ctx, "forms.manage", NO_ACCESS);

type FormRow = typeof quizForms.$inferSelect;

// ---------- Endereços ----------

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$/;

export const slugify = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 44) || "formulario";

/** Sufixo aleatório: o endereço não é sequencial nem adivinhável a partir de outro. */
const suffix = () => randomToken(6).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5).padEnd(5, "x");

async function uniqueSlug(base: string, exceptId?: string, tx: DbOrTx = db) {
  for (let i = 0; i < 8; i++) {
    const s = i === 0 ? base : `${base.slice(0, 52)}-${suffix()}`;
    const [hit] = await tx.select({ id: quizForms.id }).from(quizForms).where(eq(quizForms.slug, s));
    if (!hit || hit.id === exceptId) return s;
  }
  throw new AppError("conflict", "Não foi possível gerar um endereço único. Tente outro.");
}

export const publicUrl = (slug: string) => `${appUrl()}/forms/${slug}`;

export function embedCode(slug: string, title: string) {
  const src = publicUrl(slug);
  const safeTitle = title.replace(/[<>"&]/g, "");
  return {
    iframe: `<iframe\n  src="${src}?embed=1"\n  title="${safeTitle}"\n  width="100%"\n  height="750"\n  style="border:0;border-radius:16px;"\n  loading="lazy"\n  allow="fullscreen">\n</iframe>`,
    script: `<div data-crmlabs-form="${slug}"></div>\n<script src="${appUrl()}/forms/embed.js" async></script>`,
    fullscreen: `<iframe\n  src="${src}?embed=1&fullscreen=1"\n  title="${safeTitle}"\n  style="position:fixed;inset:0;width:100%;height:100%;border:0;z-index:2147483000;"\n  allow="fullscreen">\n</iframe>`,
  };
}

// ---------- Referências da organização ----------

async function stageRefs(orgId: string) {
  const rel = await getPipeline(orgId, "relationship");
  const stages = await db.select({ id: pipelineStages.id, key: pipelineStages.key }).from(pipelineStages).where(and(eq(pipelineStages.pipelineId, rel.id), isNull(pipelineStages.archivedAt)));
  return { relationship: (key: string) => stages.find((s) => s.key === key)?.id ?? null };
}

/** Confere se etapas, pessoas, origem e produto citados no rascunho pertencem à organização. */
async function checkRefs(ctx: Ctx, def: QuizDefinition) {
  const routes: Route[] = [def.settings.defaultRoute, ...def.scoring.tiers.map((t) => t.route)];
  const rel = await getPipeline(ctx.orgId, "relationship");
  const sales = await getPipeline(ctx.orgId, "sales");
  for (const r of routes) {
    if (r.mode === "relationship" && r.stageId) {
      const [s] = await db.select({ id: pipelineStages.id }).from(pipelineStages).where(and(eq(pipelineStages.id, r.stageId), eq(pipelineStages.pipelineId, rel.id), isNull(pipelineStages.archivedAt)));
      if (!s) throw invalid("Uma etapa do Social Seller escolhida não existe mais. Revise os destinos.");
    }
    if (r.mode === "sales" && r.salesStageId) {
      const [s] = await db.select({ id: pipelineStages.id }).from(pipelineStages).where(and(eq(pipelineStages.id, r.salesStageId), eq(pipelineStages.pipelineId, sales.id)));
      if (!s) throw invalid("Uma etapa comercial escolhida não existe mais. Revise os destinos.");
    }
  }
  const people = [...new Set([...routes.flatMap((r) => [...r.assigneeIds, ...(r.fixedAssigneeId ? [r.fixedAssigneeId] : [])]), ...def.settings.notifyUserIds])];
  if (people.length) {
    const rows = await db.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.orgId, ctx.orgId), inArray(memberships.userId, people), eq(memberships.status, "active")));
    if (rows.length !== people.length) throw invalid("Alguém escolhido como responsável ou para receber avisos não está ativo na equipe.");
  }
  if (def.settings.sourceId) {
    const [s] = await db.select({ id: leadSources.id }).from(leadSources).where(and(eq(leadSources.id, def.settings.sourceId), eq(leadSources.orgId, ctx.orgId)));
    if (!s) throw invalid("Origem inválida.");
  }
  if (def.settings.productId) {
    const [p] = await db.select({ id: products.id }).from(products).where(and(eq(products.id, def.settings.productId), eq(products.orgId, ctx.orgId)));
    if (!p) throw invalid("Produto inválido.");
  }
  const assetIds = [def.appearance.logoAssetId, def.appearance.coverAssetId, ...allQuestions(def).map((q) => q.imageAssetId)].filter((x): x is string => !!x);
  if (assetIds.length) {
    const rows = await db.select({ id: quizAssets.id }).from(quizAssets).where(and(inArray(quizAssets.id, assetIds), eq(quizAssets.orgId, ctx.orgId)));
    if (rows.length !== new Set(assetIds).size) throw invalid("Uma imagem do formulário não foi encontrada. Envie de novo.");
  }
}

function parseDefinition(raw: unknown): QuizDefinition {
  const r = definitionSchema.safeParse(raw);
  if (!r.success) {
    const first = r.error.issues[0];
    throw invalid(first?.message && first.message !== "Invalid input" ? first.message : "Algum campo do formulário está inválido.", { path: first?.path.join(".") });
  }
  return r.data as QuizDefinition;
}

// ---------- Integração de apoio (núcleo comum de leads) ----------

async function createBackingIntegration(tx: DbOrTx, orgId: string, name: string) {
  const token = randomToken(24);
  const [f] = await tx
    .insert(leadForms)
    .values({
      orgId,
      provider: QUIZ_PROVIDER,
      name,
      slug: `quiz-${randomToken(9).toLowerCase().replace(/[^a-z0-9]/g, "")}`,
      headline: name,
      questions: [],
      askEmail: false,
      askInstagram: false,
      askPreferredTime: false,
      pipelineKind: "relationship",
      stageId: null,
      assignMode: "round_robin",
      tokenHash: sha256(token),
      tokenEnc: encryptSecret(token),
    })
    .returning();
  return f;
}

/** Leva origem, produto, campanha e destino padrão da versão publicada para a integração de apoio. */
async function syncBacking(tx: DbOrTx, form: FormRow, def: QuizDefinition) {
  let leadFormId = form.leadFormId;
  if (!leadFormId) {
    leadFormId = (await createBackingIntegration(tx, form.orgId, form.name)).id;
    await tx.update(quizForms).set({ leadFormId }).where(eq(quizForms.id, form.id));
  }
  let sourceId = def.settings.sourceId;
  if (!sourceId) {
    const [o] = await tx.select({ id: leadSources.id }).from(leadSources).where(and(eq(leadSources.orgId, form.orgId), eq(leadSources.key, "outros")));
    sourceId = o?.id ?? null;
  }
  const r = def.settings.defaultRoute;
  await tx
    .update(leadForms)
    .set({
      name: form.name,
      headline: def.settings.title,
      sourceId,
      productId: def.settings.productId,
      campaign: def.settings.campaign,
      pipelineKind: r.mode === "sales" ? "sales" : "relationship",
      stageId: r.mode === "relationship" ? r.stageId : null,
      salesStageId: r.mode === "sales" ? r.salesStageId : null,
      assignMode: r.assignMode === "fixed" ? "fixed" : "round_robin",
      fixedAssigneeId: r.fixedAssigneeId,
      assigneeIds: r.assigneeIds,
      active: true,
      updatedAt: new Date(),
    })
    .where(eq(leadForms.id, leadFormId));
  return leadFormId;
}

/** Campos personalizados usados pelas perguntas (custom:<chave>) existem antes de chegar o primeiro lead. */
const CUSTOM_LABELS: Record<string, string> = { empresa: "Empresa", investimento: "Capacidade de investimento", faturamento: "Faturamento", dor_principal: "Dor principal", objetivo: "Objetivo" };

async function ensureCustomFields(tx: DbOrTx, orgId: string, def: QuizDefinition) {
  const keys = new Set<string>(["empresa"]);
  for (const q of allQuestions(def)) if (q.crmField.startsWith("custom:")) keys.add(q.crmField.slice(7));
  const existing = await tx.select().from(customFields).where(and(eq(customFields.orgId, orgId), inArray(customFields.key, [...keys])));
  const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${customFields.position}), 0)::int` }).from(customFields).where(eq(customFields.orgId, orgId));
  let pos = max;
  for (const key of keys) {
    const hit = existing.find((f) => f.key === key);
    if (hit) {
      if (hit.archivedAt) await tx.update(customFields).set({ archivedAt: null }).where(eq(customFields.id, hit.id));
      continue;
    }
    const q = allQuestions(def).find((x) => x.crmField === `custom:${key}`);
    const label = CUSTOM_LABELS[key] ?? (q?.title ?? key).replace(/\?$/, "").slice(0, 60);
    await tx.insert(customFields).values({ orgId, key, label, position: ++pos }).onConflictDoNothing();
  }
}

// ---------- Leitura ----------

function hasUnpublished(f: FormRow) {
  return !f.publishedAt || f.draftUpdatedAt.getTime() > f.publishedAt.getTime() + 500;
}

function view(f: FormRow) {
  return {
    id: f.id,
    name: f.name,
    slug: f.slug,
    status: f.status,
    title: f.draft.settings.title,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
    draftUpdatedAt: f.draftUpdatedAt,
    publishedAt: f.publishedAt,
    live: !!f.liveVersionId && f.status === "published",
    hasUnpublishedChanges: hasUnpublished(f),
    allowedDomains: f.allowedDomains,
    templateKey: f.templateKey,
    publicUrl: publicUrl(f.slug),
    embed: embedCode(f.slug, f.draft.settings.title),
  };
}

async function own(ctx: Ctx, id: string, tx: DbOrTx = db) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Formulário não encontrado.");
  const [f] = await tx.select().from(quizForms).where(and(eq(quizForms.id, id), eq(quizForms.orgId, ctx.orgId)));
  if (!f) throw notFound("Formulário não encontrado.");
  return f;
}

export const listFormsSchema = z.object({ status: z.enum(["all", "draft", "published", "archived", "active"]).default("active"), q: z.string().trim().max(80).optional() });

export async function listForms(ctx: Ctx, f: z.infer<typeof listFormsSchema>) {
  assertForms(ctx);
  const rows = await db.select().from(quizForms).where(eq(quizForms.orgId, ctx.orgId)).orderBy(desc(quizForms.createdAt));
  const ids = rows.map((r) => r.id);
  const subs = ids.length
    ? await db.select({ formId: quizSubmissions.formId, n: sql<number>`count(*)::int` }).from(quizSubmissions).where(and(inArray(quizSubmissions.formId, ids), isNull(quizSubmissions.duplicateOf))).groupBy(quizSubmissions.formId)
    : [];
  const evs = ids.length
    ? await db.select({ formId: quizEvents.formId, kind: quizEvents.kind, n: sql<number>`count(*)::int` }).from(quizEvents).where(inArray(quizEvents.formId, ids)).groupBy(quizEvents.formId, quizEvents.kind)
    : [];
  const q = f.q?.toLowerCase();
  return rows
    .filter((r) => (f.status === "all" ? true : f.status === "active" ? r.status !== "archived" : r.status === f.status))
    .filter((r) => !q || r.name.toLowerCase().includes(q) || r.draft.settings.title.toLowerCase().includes(q))
    .map((r) => {
      const responses = subs.find((s) => s.formId === r.id)?.n ?? 0;
      const views = evs.find((e) => e.formId === r.id && e.kind === "view")?.n ?? 0;
      return { ...view(r), responses, views, conversion: views ? Math.min(1, responses / views) : 0 };
    });
}

export async function getForm(ctx: Ctx, id: string) {
  assertForms(ctx);
  const f = await own(ctx, id);
  const versions = await db
    .select({ id: quizFormVersions.id, version: quizFormVersions.version, publishedAt: quizFormVersions.publishedAt, publishedBy: users.name, maxPoints: quizFormVersions.maxPoints })
    .from(quizFormVersions)
    .leftJoin(users, eq(users.id, quizFormVersions.publishedBy))
    .where(eq(quizFormVersions.formId, f.id))
    .orderBy(desc(quizFormVersions.version));
  const [{ responses }] = await db.select({ responses: sql<number>`count(*)::int` }).from(quizSubmissions).where(eq(quizSubmissions.formId, f.id));
  return {
    ...view(f),
    draft: f.draft,
    versions,
    liveVersion: versions.find((v) => v.id === f.liveVersionId)?.version ?? null,
    responses,
    problems: publishProblems(f.draft),
  };
}

/** Histórico de alterações do formulário (rascunhos salvos, publicações, regras de pontuação). */
export async function formHistory(ctx: Ctx, id: string) {
  assertForms(ctx);
  const f = await own(ctx, id);
  return db
    .select({ id: auditEvents.id, action: auditEvents.action, data: auditEvents.data, createdAt: auditEvents.createdAt, actorName: users.name })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorId))
    .where(and(eq(auditEvents.orgId, ctx.orgId), eq(auditEvents.entityType, "quiz_form"), eq(auditEvents.entityId, f.id)))
    .orderBy(desc(auditEvents.createdAt))
    .limit(100);
}

// ---------- Criar / salvar ----------

export const createFormSchema = z.object({
  name: z.string().trim().min(2, "Dê um nome ao formulário.").max(120),
  template: z.enum(["blank", AXION_TEMPLATE_KEY]).default("blank"),
});

export async function createForm(ctx: Ctx, input: z.infer<typeof createFormSchema>) {
  assertForms(ctx);
  const def = input.template === AXION_TEMPLATE_KEY ? axionDefinition(await stageRefs(ctx.orgId)) : blankDefinition(input.name);
  if (input.template === "blank") def.settings.title = input.name;
  const f = await db.transaction(async (tx) => {
    const backing = await createBackingIntegration(tx, ctx.orgId, input.name);
    const [row] = await tx
      .insert(quizForms)
      .values({
        orgId: ctx.orgId,
        name: input.name,
        slug: await uniqueSlug(`${slugify(input.template === AXION_TEMPLATE_KEY ? "diagnostico-axion" : input.name)}-${suffix()}`, undefined, tx),
        draft: def,
        leadFormId: backing.id,
        templateKey: input.template,
        createdBy: ctx.userId,
      })
      .returning();
    await audit(tx, ctx, "form.created", "quiz_form", row.id, { name: input.name, template: input.template });
    return row;
  });
  return getForm(ctx, f.id);
}

export const saveDraftSchema = z.object({
  name: z.string().trim().min(2, "Dê um nome interno ao formulário.").max(120).optional(),
  slug: z.string().trim().toLowerCase().optional(),
  draft: z.unknown().optional(),
  allowedDomains: z.array(z.string().trim().toLowerCase().max(200)).max(20).optional(),
  /** Evita sobrescrever o trabalho de outra pessoa: data do rascunho que o editor carregou. */
  baseUpdatedAt: z.string().optional(),
});

const DOMAIN_RE = /^(\*\.)?([a-z0-9-]+\.)+[a-z]{2,}(:\d{2,5})?$/;

function normalizeDomain(d: string) {
  const t = d.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!DOMAIN_RE.test(t) && !/^localhost(:\d+)?$/.test(t)) throw invalid(`Domínio inválido: ${d}. Use algo como meusite.com.br.`);
  return t;
}

/** Resumo do que mudou nas regras de pontuação (para a auditoria). */
function scoringSummary(def: QuizDefinition) {
  return {
    enabled: def.scoring.enabled,
    normalize: def.scoring.normalize,
    weights: Object.fromEntries(allQuestions(def).filter((q) => q.scored).map((q) => [q.id, (q.options ?? []).map((o) => `${o.id}:${o.points}`).join(",")])),
    tiers: def.scoring.tiers.map((t) => ({ id: t.id, min: t.min, demoteTo: t.demoteTo, requirements: t.requirements.map((r) => `${r.questionId}∈[${r.optionIds.join(",")}]`), route: t.route })),
  };
}

export async function saveDraft(ctx: Ctx, id: string, input: z.infer<typeof saveDraftSchema>) {
  assertForms(ctx);
  const f = await own(ctx, id);
  if (f.status === "archived") throw invalid("Restaure o formulário antes de editar.");
  if (input.baseUpdatedAt && Math.abs(new Date(input.baseUpdatedAt).getTime() - f.draftUpdatedAt.getTime()) > 1) {
    throw new AppError("conflict", "Outra pessoa salvou este formulário depois que você abriu. Recarregue para ver a versão mais recente.");
  }
  const patch: Partial<typeof quizForms.$inferInsert> = { updatedAt: new Date() };
  const changes: string[] = [];
  let scoringChanged = false;
  if (input.name !== undefined && input.name !== f.name) {
    patch.name = input.name;
    changes.push("nome interno");
  }
  if (input.slug !== undefined && input.slug !== f.slug) {
    if (!SLUG_RE.test(input.slug)) throw invalid("Endereço: use letras minúsculas, números e hífen (3 a 60 caracteres).");
    const taken = await uniqueSlug(input.slug, f.id);
    if (taken !== input.slug) throw new AppError("conflict", "Esse endereço já está em uso. Escolha outro.");
    patch.slug = input.slug;
    changes.push("endereço");
  }
  if (input.allowedDomains !== undefined) {
    patch.allowedDomains = [...new Set(input.allowedDomains.filter(Boolean).map(normalizeDomain))];
    changes.push("domínios autorizados");
  }
  if (input.draft !== undefined) {
    const def = parseDefinition(input.draft);
    await checkRefs(ctx, def);
    scoringChanged = JSON.stringify(scoringSummary(def)) !== JSON.stringify(scoringSummary(f.draft));
    patch.draft = def;
    patch.draftUpdatedAt = new Date();
    changes.push(scoringChanged ? "perguntas/regras de pontuação" : "conteúdo");
  }
  const [u] = await db.update(quizForms).set(patch).where(eq(quizForms.id, f.id)).returning();
  if (patch.slug && f.status === "published") {
    await db.insert(quizPublications).values({ orgId: ctx.orgId, formId: f.id, versionId: f.liveVersionId, action: "slug_changed", slug: patch.slug, actorId: ctx.userId });
  }
  if (changes.length) {
    await audit(db, ctx, "form.draft_saved", "quiz_form", f.id, { changes, ...(patch.slug ? { slug: { from: f.slug, to: patch.slug } } : {}) });
    if (scoringChanged) await audit(db, ctx, "form.scoring_draft_changed", "quiz_form", f.id, { before: scoringSummary(f.draft), after: scoringSummary(patch.draft!) });
  }
  return getForm(ctx, u.id);
}

// ---------- Publicação ----------

export async function publishForm(ctx: Ctx, id: string) {
  assertForms(ctx);
  const result = await db.transaction(async (tx) => {
    const [f] = await tx.select().from(quizForms).where(and(eq(quizForms.id, id), eq(quizForms.orgId, ctx.orgId))).for("update");
    if (!f) throw notFound("Formulário não encontrado.");
    if (f.status === "archived") throw invalid("Restaure o formulário antes de publicar.");
    const def = parseDefinition(f.draft);
    const problems = publishProblems(def);
    if (problems.length) throw invalid(problems[0], { problems });
    await checkRefs(ctx, def);
    await ensureCustomFields(tx, ctx.orgId, def);
    const [{ last }] = await tx.select({ last: sql<number>`coalesce(max(${quizFormVersions.version}), 0)::int` }).from(quizFormVersions).where(eq(quizFormVersions.formId, f.id));
    const [prev] = f.latestVersionId ? await tx.select().from(quizFormVersions).where(eq(quizFormVersions.id, f.latestVersionId)) : [];
    const [v] = await tx
      .insert(quizFormVersions)
      .values({ orgId: ctx.orgId, formId: f.id, version: last + 1, definition: def, maxPoints: maxPoints(def), publishedBy: ctx.userId })
      .returning();
    // Espelho relacional da versão (consultas e relatórios).
    for (const [si, s] of def.sections.entries()) {
      const [sec] = await tx.insert(quizSections).values({ orgId: ctx.orgId, versionId: v.id, key: s.id, title: s.title || `Etapa ${si + 1}`, position: si }).returning();
      for (const [qi, q] of s.questions.entries()) {
        const [qq] = await tx
          .insert(quizQuestions)
          .values({ orgId: ctx.orgId, versionId: v.id, sectionId: sec.id, key: q.id, type: q.type, title: q.title, required: q.required, scored: q.scored, crmField: q.crmField, showIf: q.showIf ?? null, position: qi })
          .returning();
        if (q.options?.length) await tx.insert(quizOptions).values(q.options.map((o, oi) => ({ orgId: ctx.orgId, questionId: qq.id, key: o.id, label: o.label, points: o.points, position: oi })));
      }
    }
    if (def.scoring.tiers.length) {
      await tx.insert(quizScoringRules).values(def.scoring.tiers.map((t, i) => ({ orgId: ctx.orgId, versionId: v.id, tierKey: t.id, label: t.label, minScore: t.min, requirements: t.requirements, route: t.route, position: i })));
    }
    const now = new Date();
    await syncBacking(tx, f, def);
    await tx.update(quizForms).set({ status: "published", liveVersionId: v.id, latestVersionId: v.id, publishedAt: now, draftUpdatedAt: f.draftUpdatedAt, updatedAt: now }).where(eq(quizForms.id, f.id));
    await tx.insert(quizPublications).values({ orgId: ctx.orgId, formId: f.id, versionId: v.id, action: "published", slug: f.slug, actorId: ctx.userId });
    await audit(tx, ctx, "form.published", "quiz_form", f.id, { version: v.version, slug: f.slug });
    if (prev && JSON.stringify(scoringSummary(prev.definition)) !== JSON.stringify(scoringSummary(def))) {
      await audit(tx, ctx, "form.scoring_published", "quiz_form", f.id, { fromVersion: prev.version, toVersion: v.version, before: scoringSummary(prev.definition), after: scoringSummary(def) });
    }
    return { version: v.version };
  });
  return { ...(await getForm(ctx, id)), publishedVersion: result.version };
}

export async function unpublishForm(ctx: Ctx, id: string) {
  assertForms(ctx);
  const f = await own(ctx, id);
  if (f.status !== "published") throw invalid("Este formulário não está publicado.");
  await db.transaction(async (tx) => {
    await tx.update(quizForms).set({ status: "draft", liveVersionId: null, updatedAt: new Date() }).where(eq(quizForms.id, f.id));
    await tx.insert(quizPublications).values({ orgId: ctx.orgId, formId: f.id, versionId: f.liveVersionId, action: "unpublished", slug: f.slug, actorId: ctx.userId });
    await audit(tx, ctx, "form.unpublished", "quiz_form", f.id, { slug: f.slug });
  });
  return getForm(ctx, id);
}

export async function archiveForm(ctx: Ctx, id: string, archived: boolean) {
  assertForms(ctx);
  const f = await own(ctx, id);
  await db.transaction(async (tx) => {
    if (archived) {
      await tx.update(quizForms).set({ status: "archived", liveVersionId: null, archivedAt: new Date(), updatedAt: new Date() }).where(eq(quizForms.id, f.id));
      if (f.liveVersionId) await tx.insert(quizPublications).values({ orgId: ctx.orgId, formId: f.id, versionId: f.liveVersionId, action: "unpublished", slug: f.slug, actorId: ctx.userId });
    } else {
      await tx.update(quizForms).set({ status: "draft", archivedAt: null, updatedAt: new Date() }).where(eq(quizForms.id, f.id));
    }
    await audit(tx, ctx, archived ? "form.archived" : "form.restored", "quiz_form", f.id);
  });
  return getForm(ctx, id);
}

export async function duplicateForm(ctx: Ctx, id: string) {
  assertForms(ctx);
  const f = await own(ctx, id);
  const name = `${f.name} (cópia)`.slice(0, 120);
  const copy = await db.transaction(async (tx) => {
    const backing = await createBackingIntegration(tx, ctx.orgId, name);
    const [row] = await tx
      .insert(quizForms)
      .values({ orgId: ctx.orgId, name, slug: await uniqueSlug(`${slugify(f.name).slice(0, 40)}-${suffix()}`, undefined, tx), draft: f.draft, leadFormId: backing.id, templateKey: f.templateKey, allowedDomains: f.allowedDomains, createdBy: ctx.userId })
      .returning();
    await audit(tx, ctx, "form.duplicated", "quiz_form", row.id, { from: f.id });
    return row;
  });
  return getForm(ctx, copy.id);
}

/** Exclui só formulários sem respostas. Com respostas, o caminho é arquivar (nada de apagar dados). */
export async function deleteForm(ctx: Ctx, id: string) {
  assertForms(ctx);
  const f = await own(ctx, id);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(quizSubmissions).where(eq(quizSubmissions.formId, f.id));
  if (n > 0) throw new AppError("conflict", `Este formulário tem ${n} resposta(s) e não pode ser excluído. Arquive-o para tirá-lo do ar e preservar o histórico.`);
  await db.transaction(async (tx) => {
    await tx.delete(quizForms).where(eq(quizForms.id, f.id));
    if (f.leadFormId) await tx.delete(leadForms).where(and(eq(leadForms.id, f.leadFormId), eq(leadForms.provider, QUIZ_PROVIDER)));
    await audit(tx, ctx, "form.deleted", "quiz_form", f.id, { name: f.name, slug: f.slug });
  });
}

// ---------- Opções do editor ----------

/** Etapas dos funis e pessoas da equipe para configurar destinos. */
export async function editorOptions(ctx: Ctx) {
  assertForms(ctx);
  const rel = await getPipeline(ctx.orgId, "relationship");
  const sales = await getPipeline(ctx.orgId, "sales");
  const stages = await db
    .select({ id: pipelineStages.id, pipelineId: pipelineStages.pipelineId, name: pipelineStages.name, color: pipelineStages.color, stageType: pipelineStages.stageType, position: pipelineStages.position })
    .from(pipelineStages)
    .where(and(inArray(pipelineStages.pipelineId, [rel.id, sales.id]), isNull(pipelineStages.archivedAt)))
    .orderBy(asc(pipelineStages.position));
  const team = await db
    .select({ userId: memberships.userId, name: users.name, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.status, "active")))
    .orderBy(asc(users.name));
  const sources = await db.select({ id: leadSources.id, name: leadSources.name, color: leadSources.color }).from(leadSources).where(and(eq(leadSources.orgId, ctx.orgId), isNull(leadSources.archivedAt))).orderBy(asc(leadSources.position));
  const prods = await db.select({ id: products.id, name: products.name }).from(products).where(and(eq(products.orgId, ctx.orgId), isNull(products.archivedAt))).orderBy(asc(products.name));
  const fields = await db.select({ key: customFields.key, label: customFields.label }).from(customFields).where(and(eq(customFields.orgId, ctx.orgId), isNull(customFields.archivedAt))).orderBy(asc(customFields.position));
  return {
    relationshipStages: stages.filter((s) => s.pipelineId === rel.id),
    salesStages: stages.filter((s) => s.pipelineId === sales.id && !["won", "lost"].includes(s.stageType)),
    team,
    sources,
    products: prods,
    customFields: fields,
    appUrl: appUrl(),
  };
}

// ---------- Imagens ----------

export const ASSET_MAX_UPLOAD = 8 * 1024 * 1024;

export async function uploadAsset(ctx: Ctx, buf: Buffer, kind: "logo" | "cover" | "image") {
  assertForms(ctx);
  if (!buf.length) throw invalid("Escolha uma imagem.");
  if (buf.length > ASSET_MAX_UPLOAD) throw invalid("Imagem grande demais (máximo 8 MB).");
  const type = sniffImage(buf);
  if (!type) throw invalid("Formato não suportado. Use JPG, PNG ou WebP.");
  let data = buf;
  let mime: string = type;
  let width: number | null = null;
  let height: number | null = null;
  try {
    const sharp = (await import("sharp")).default;
    const side = kind === "logo" ? 600 : 1600;
    const out = await sharp(buf, { failOn: "error", limitInputPixels: 50_000_000 })
      .rotate()
      .resize(side, side, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 84, alphaQuality: 90 })
      .toBuffer({ resolveWithObject: true });
    data = out.data;
    mime = "image/webp";
    width = out.info.width;
    height = out.info.height;
  } catch (e) {
    logger.warn("Imagem do formulário guardada sem reprocessar", e);
    if (buf.length > 1_500_000) throw invalid("Não foi possível processar esta imagem. Tente um arquivo menor.");
  }
  const [row] = await db.insert(quizAssets).values({ orgId: ctx.orgId, data, mime, width, height, createdBy: ctx.userId }).returning({ id: quizAssets.id });
  return { id: row.id, url: assetUrl(row.id) };
}

export const assetUrl = (id: string) => `/api/public/form-assets/${id}`;

/** Imagens são públicas (aparecem no formulário publicado); o id é aleatório. */
export async function getAsset(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const [row] = await db.select({ data: quizAssets.data, mime: quizAssets.mime }).from(quizAssets).where(eq(quizAssets.id, id));
  if (!row) throw notFound("Imagem não encontrada.");
  return row;
}

// ---------- Painel geral ----------

export const dashboardSchema = z.object({ days: z.coerce.number().int().min(7).max(365).default(30) });

export async function formsDashboard(ctx: Ctx, f: z.infer<typeof dashboardSchema>) {
  assertForms(ctx);
  const since = new Date(Date.now() - f.days * 86400000);
  const forms = await db.select({ id: quizForms.id, status: quizForms.status }).from(quizForms).where(eq(quizForms.orgId, ctx.orgId));
  const [ev] = await db
    .select({
      views: sql<number>`count(*) filter (where ${quizEvents.kind} = 'view')::int`,
      starts: sql<number>`count(*) filter (where ${quizEvents.kind} = 'start')::int`,
    })
    .from(quizEvents)
    .where(and(eq(quizEvents.orgId, ctx.orgId), gte(quizEvents.createdAt, since)));
  const subs = await db
    .select({ completedAt: quizSubmissions.completedAt, tierLabel: quizSubmissions.tierLabel, tierId: quizSubmissions.tierId, formId: quizSubmissions.formId, channel: quizSubmissions.channel, utmSource: sql<string | null>`${quizSubmissions.utm}->>'utm_source'`, classification: quizSubmissions.classification })
    .from(quizSubmissions)
    .where(and(eq(quizSubmissions.orgId, ctx.orgId), gte(quizSubmissions.completedAt, since), isNull(quizSubmissions.duplicateOf)))
    .limit(50000);
  // Faixas "qualificadas" vêm da versão de cada formulário.
  const versions = await db.select({ formId: quizFormVersions.formId, definition: quizFormVersions.definition, version: quizFormVersions.version }).from(quizFormVersions).where(eq(quizFormVersions.orgId, ctx.orgId));
  const qualifiedTier = (formId: string, tierId: string | null) => !!tierId && versions.some((v) => v.formId === formId && v.definition.scoring.tiers.some((t) => t.id === tierId && t.qualified));
  const byTier = new Map<string, number>();
  const byOrigin = new Map<string, number>();
  const byDay = new Map<string, number>();
  const tz = ctx.org.timezone;
  const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  for (const s of subs) {
    const t = s.tierLabel ?? "Sem classificação";
    byTier.set(t, (byTier.get(t) ?? 0) + 1);
    const o = originLabel(s.channel, s.utmSource);
    byOrigin.set(o, (byOrigin.get(o) ?? 0) + 1);
    const k = dayKey(s.completedAt);
    byDay.set(k, (byDay.get(k) ?? 0) + 1);
  }
  const series: { day: string; count: number }[] = [];
  for (let i = f.days - 1; i >= 0; i--) {
    const k = dayKey(new Date(Date.now() - i * 86400000));
    series.push({ day: k, count: byDay.get(k) ?? 0 });
  }
  const completed = subs.length;
  return {
    days: f.days,
    totals: {
      forms: forms.filter((x) => x.status !== "archived").length,
      published: forms.filter((x) => x.status === "published").length,
      drafts: forms.filter((x) => x.status === "draft").length,
      archived: forms.filter((x) => x.status === "archived").length,
      views: ev?.views ?? 0,
      starts: ev?.starts ?? 0,
      responses: completed,
      completionRate: ev?.starts ? Math.min(1, completed / ev.starts) : 0,
      qualified: subs.filter((s) => qualifiedTier(s.formId, s.tierId)).length,
    },
    byTier: [...byTier.entries()]
      .map(([label, count]) => ({ label, count, color: versions.flatMap((v) => v.definition.scoring.tiers).find((t) => t.label === label)?.color ?? "gray" }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    byOrigin: [...byOrigin.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    series,
  };
}

export function originLabel(channel: string, utmSource: string | null | undefined) {
  if (utmSource) return utmSource;
  return channel === "embed" ? "Site (incorporado)" : "Link direto";
}

