import { and, asc, desc, eq, gt, gte, ilike, lt, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "../db";
import {
  appointments,
  contactTouchpoints,
  contacts,
  conversations,
  customFields,
  integrationLogs,
  leadForms,
  leadSources,
  leads,
  loginAttempts,
  memberships,
  opportunities,
  organizations,
  pipelineStages,
  products,
  quizForms,
  quizSubmissions,
  relationshipEntries,
  stageHistory,
  users,
} from "../db/schema";
import type { Ctx } from "../context";
import { AppError, forbidden, invalid, notFound } from "../errors";
import { can, leadScope } from "../permissions";
import { publish } from "../realtime";
import { parseLocalDateTime } from "../time";
import { logger } from "../logger";
import { audit, cleanText, closerPipeline, CONTATO_KEY, FORA_DO_ICP_KEY, getPipeline, normalizeHandle, NOVO_INTERESSADO_KEY, notifyUser } from "./common";
import { activeEntryFor, addToBoard } from "./board";
import { UTM_KEYS } from "../integrations/forms/normalize";
import { LEAD_PERIODS, NO_SOURCE, PERIOD_DAYS, type LeadPeriod } from "@/lib/leadSources";
import { classFromProduct, LEAD_CLASSES, LEAD_CLASS_FILTERS, TOP_LEADS_LIMIT, TOP_REVENUE_OPTIONS, type LeadClass } from "@/lib/leadScore";

// ---------- Normalização ----------

/** Telefone só com dígitos e DDI (+55 quando parece brasileiro). */
export function normalizePhone(v: string | null | undefined) {
  const raw = cleanText(v, 40);
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (d.length < 10 || d.length > 15) return null;
  return `+${d}`;
}

export function normalizeEmail(v: string | null | undefined) {
  const e = cleanText(v, 200)?.toLowerCase() ?? null;
  return e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

export function cleanUtm(input: Record<string, unknown> | undefined | null) {
  const out: Record<string, string> = {};
  if (!input) return out;
  for (const k of UTM_KEYS) {
    const v = input[k];
    if (typeof v === "string" || typeof v === "number") {
      const t = cleanText(String(v), 300);
      if (t) out[k] = t;
    }
  }
  return out;
}

// ---------- Formulário público (Formulário CRMLABS) ----------

export async function getPublicForm(slug: string) {
  const [row] = await db
    .select({ f: leadForms, orgName: organizations.name })
    .from(leadForms)
    .innerJoin(organizations, eq(organizations.id, leadForms.orgId))
    .where(and(eq(leadForms.slug, slug.toLowerCase()), eq(leadForms.active, true), sql`${leadForms.provider} <> ${QUIZ_PROVIDER}`));
  if (!row) return null;
  const f = row.f;
  return {
    slug: f.slug,
    orgName: row.orgName,
    headline: f.headline,
    description: f.description,
    questions: f.questions,
    askEmail: f.askEmail,
    askInstagram: f.askInstagram,
    askPreferredTime: f.askPreferredTime,
    thankYou: f.thankYou,
  };
}

export const publicSubmitSchema = z.object({
  name: z.string().trim().min(2, "Informe seu nome.").max(120),
  phone: z.string().trim().min(1, "Informe seu WhatsApp com DDD.").max(40),
  email: z.string().trim().max(200).optional().default(""),
  instagram: z.string().trim().max(60).optional().default(""),
  preferredAt: z.string().trim().max(40).optional().default(""),
  answers: z.record(z.string().max(40), z.string().max(2000)).default({}),
  consent: z.literal(true, { message: "É preciso concordar para enviar." }),
  utm: z.record(z.string(), z.string().max(300)).optional(),
  /** Campo invisível: robôs costumam preencher. */
  website: z.string().max(200).optional().default(""),
  startedAt: z.number().optional(),
});

const PUBLIC_LIMIT_PER_HOUR = 8;

export async function submitPublicForm(slug: string, raw: unknown, ip: string | null) {
  const [form] = await db.select().from(leadForms).where(and(eq(leadForms.slug, slug.toLowerCase()), eq(leadForms.active, true), sql`${leadForms.provider} <> ${QUIZ_PROVIDER}`));
  if (!form) throw notFound("Este formulário não está mais disponível.");
  const input = publicSubmitSchema.parse(raw);
  const thanks = { ok: true, message: form.thankYou || "Recebemos seus dados! Em breve alguém da equipe vai falar com você." };
  // Robô: responde como se tivesse dado certo, sem registrar nada.
  if (input.website || (input.startedAt && Date.now() - input.startedAt < 2500)) return thanks;

  const key = `leadform:${ip ?? "?"}`;
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.key, key), gt(loginAttempts.createdAt, sql`now() - interval '1 hour'`)));
  if (n >= PUBLIC_LIMIT_PER_HOUR) throw new AppError("rate_limited", "Muitos envios seguidos. Tente novamente mais tarde.");
  await db.insert(loginAttempts).values({ key, success: true });

  const phone = normalizePhone(input.phone);
  if (!phone) throw new AppError("invalid", "WhatsApp inválido.", { fields: { phone: "Informe o WhatsApp com DDD, só números." } });
  const email = form.askEmail && input.email ? normalizeEmail(input.email) : null;
  if (form.askEmail && input.email && !email) throw new AppError("invalid", "E-mail inválido.", { fields: { email: "Confira o e-mail." } });

  const answers: { label: string; value: string }[] = [];
  const custom: Record<string, string> = {};
  let productText: string | null = null;
  const fieldErrors: Record<string, string> = {};
  const mapOf = (qid: string) => form.fieldMap.find((m) => m.key === qid)?.target ?? "answer";
  for (const q of form.questions) {
    let v = cleanText(input.answers[q.id], q.type === "textarea" ? 2000 : 500) ?? "";
    if (q.type === "choice" && v && q.options?.length && !q.options.includes(v)) v = "";
    if (q.type === "number" && v && !/^-?\d+([.,]\d+)?$/.test(v)) {
      fieldErrors[`q_${q.id}`] = "Informe um número.";
      continue;
    }
    if (q.required && !v) fieldErrors[`q_${q.id}`] = "Responda esta pergunta.";
    if (!v) continue;
    const target = mapOf(q.id);
    if (target === "ignore") continue;
    if (target === "product") productText = v;
    if (typeof target === "string" && target.startsWith("custom:")) custom[target.slice(7)] = v;
    answers.push({ label: q.label, value: v });
  }
  let preferredAt: Date | null = null;
  if (form.askPreferredTime && input.preferredAt) {
    preferredAt = parseLocalDateTime(input.preferredAt, "America/Bahia");
    if (!preferredAt || preferredAt.getTime() < Date.now() - 3600_000) fieldErrors.preferredAt = "Escolha uma data futura.";
  }
  if (Object.keys(fieldErrors).length) throw new AppError("invalid", "Confira os campos destacados.", { fields: fieldErrors });

  await ingestLead(form, {
    name: input.name,
    phone,
    email,
    instagram: form.askInstagram ? normalizeHandle(input.instagram) : null,
    answers,
    custom,
    productText,
    preferredAt,
    preferredText: null,
    utm: cleanUtm(input.utm),
    channel: "crmlabs_form",
  });
  return thanks;
}

// ---------- Webhook (Zapier, Make, landing pages, Meta via integradores) ----------


// ---------- Entrada do lead (comum a todos os conectores) ----------

export type LeadInput = {
  name: string;
  phone: string | null;
  email: string | null;
  instagram: string | null;
  answers: { label: string; value: string }[];
  custom?: Record<string, string>;
  productText?: string | null;
  preferredAt: Date | null;
  preferredText: string | null;
  utm: Record<string, string>;
  /** Conector que trouxe o lead (crmlabs_form, webhook, typeform…). */
  channel: string;
};

type Integration = typeof leadForms.$inferSelect;

/** Formulários & Quizzes usam uma integração de apoio própria (fica fora da Central de Integrações e de /f/[slug]). */
export const QUIZ_PROVIDER = "crmlabs_quiz";

/**
 * Ajustes por envio (Formulários & Quizzes): o destino depende da classificação do lead.
 * `afterInsert` roda dentro da mesma transação, depois de o lead existir.
 */
export type IngestOptions = {
  route?: Partial<Pick<Integration, "pipelineKind" | "stageId" | "salesStageId" | "assignMode" | "fixedAssigneeId" | "assigneeIds" | "sourceId">> & { noAssign?: boolean };
  notify?: boolean;
  touchpointNote?: string;
  afterInsert?: (tx: DbOrTx, r: { lead: typeof leads.$inferSelect; contactId: string; returning: boolean }) => Promise<void>;
};

/** Quem pode receber o lead: responsável fixo ou rodízio (selecionados; senão todos os sellers/closers ativos). */
async function candidates(tx: DbOrTx, form: Integration) {
  const active = and(eq(memberships.orgId, form.orgId), eq(memberships.status, "active"));
  if (form.assignMode === "fixed" && form.fixedAssigneeId) {
    const rows = await tx.select({ userId: memberships.userId }).from(memberships).where(and(active, eq(memberships.userId, form.fixedAssigneeId)));
    if (rows.length) return { pool: rows.map((r) => r.userId), fixed: true };
  }
  const conds: SQL[] = [active!];
  if (form.assigneeIds.length) conds.push(inArray(memberships.userId, form.assigneeIds));
  else conds.push(eq(memberships.role, form.pipelineKind === "sales" ? "closer" : "seller"));
  const rows = await tx.select({ userId: memberships.userId }).from(memberships).where(and(...conds)).orderBy(asc(memberships.createdAt), asc(memberships.userId));
  return { pool: rows.map((r) => r.userId), fixed: false };
}

/** Procura a pessoa por telefone, e-mail ou Instagram (sem criar duplicado). */
export async function findContact(tx: DbOrTx, orgId: string, input: Pick<LeadInput, "phone" | "email" | "instagram">) {
  const ors: SQL[] = [];
  if (input.email) ors.push(sql`lower(${contacts.email}) = ${input.email}`);
  if (input.phone) ors.push(sql`regexp_replace(coalesce(${contacts.phone}, ''), '\\D', '', 'g') = ${input.phone.replace(/\D/g, "")}`);
  if (input.instagram) ors.push(sql`lower(${contacts.username}) = ${input.instagram}`);
  if (!ors.length) return null;
  const [c] = await tx
    .select()
    .from(contacts)
    .where(and(eq(contacts.orgId, orgId), isNull(contacts.mergedIntoId), isNull(contacts.archivedAt), or(...ors)))
    .orderBy(asc(contacts.createdAt))
    .limit(1);
  return c ?? null;
}

export async function logIntegration(tx: DbOrTx, form: Pick<Integration, "id" | "orgId" | "name">, entry: { event: string; result: "success" | "error"; message?: string | null; leadId?: string | null; detected?: Record<string, boolean> }) {
  await tx.insert(integrationLogs).values({ orgId: form.orgId, integrationId: form.id, integrationName: form.name, event: entry.event, result: entry.result, message: entry.message ?? null, leadId: entry.leadId ?? null, detected: entry.detected ?? null });
}

/**
 * Recebe um lead de qualquer conector: atribui origem, procura a pessoa (sem duplicar),
 * cria ou atualiza o contato, registra o ponto de contato na jornada, coloca no funil
 * escolhido, distribui e avisa somente quem recebeu.
 */
export async function ingestLead(form: Integration, input: LeadInput, opts: IngestOptions = {}) {
  const now = new Date();
  const { noAssign, ...routeOverride } = opts.route ?? {};
  const { lead, contactCreated, returning, sourceName, productName } = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(leadForms).where(eq(leadForms.id, form.id)).for("update");
    const locked: Integration = { ...row, ...routeOverride };
    const { pool, fixed } = noAssign ? { pool: [] as string[], fixed: true } : await candidates(tx, locked);
    let contact = await findContact(tx, form.orgId, input);
    const returning = !!contact;

    // Produto: o que o lead escolheu (se existir no cadastro) ou o produto da integração.
    let productId = locked.productId;
    if (input.productText) {
      const [p] = await tx.select({ id: products.id }).from(products).where(and(eq(products.orgId, form.orgId), sql`lower(${products.name}) = ${input.productText.toLowerCase()}`, isNull(products.archivedAt)));
      if (p) productId = p.id;
    }
    const [prod] = productId ? await tx.select({ name: products.name }).from(products).where(eq(products.id, productId)) : [];
    const [src] = locked.sourceId ? await tx.select({ name: leadSources.name }).from(leadSources).where(eq(leadSources.id, locked.sourceId)) : [];

    // Distribuição: cliente que volta fica com o mesmo responsável (se ativo e no funil social seller).
    let assignedTo: string | null = null;
    if (!noAssign && !fixed && contact?.ownerId && locked.pipelineKind !== "sales") {
      const [m] = await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.orgId, form.orgId), eq(memberships.userId, contact.ownerId), eq(memberships.status, "active")));
      if (m) assignedTo = contact.ownerId;
    }
    if (!assignedTo && pool.length) {
      assignedTo = pool[row.rotation % pool.length];
      if (!fixed) await tx.update(leadForms).set({ rotation: row.rotation + 1 }).where(eq(leadForms.id, form.id));
    }
    const contactOwner = locked.pipelineKind === "sales" ? null : assignedTo;

    let contactCreated = false;
    if (!contact) {
      [contact] = await tx
        .insert(contacts)
        .values({
          orgId: form.orgId,
          name: input.name,
          username: input.instagram,
          profileUrl: input.instagram ? `https://www.instagram.com/${input.instagram}/` : null,
          email: input.email,
          phone: input.phone,
          ownerId: contactOwner,
          source: "lead_form",
          summary: [src?.name, locked.name].filter(Boolean).join(" · "),
          lastInteractionAt: now,
          firstSourceId: locked.sourceId,
          firstTouchAt: now,
          lastSourceId: locked.sourceId,
          lastTouchAt: now,
        })
        .returning();
      contactCreated = true;
    } else {
      const patch: Partial<typeof contacts.$inferInsert> = { lastInteractionAt: now, updatedAt: now };
      if (!contact.ownerId && contactOwner) patch.ownerId = contactOwner;
      if (!contact.email && input.email) patch.email = input.email;
      if (!contact.phone && input.phone) patch.phone = input.phone;
      if (!contact.username && input.instagram) patch.username = input.instagram;
      // Histórico preservado: a primeira origem nunca é sobrescrita.
      if (locked.sourceId) {
        if (!contact.firstSourceId) {
          patch.firstSourceId = locked.sourceId;
          patch.firstTouchAt = now;
        }
        patch.lastSourceId = locked.sourceId;
        patch.lastTouchAt = now;
      }
      [contact] = await tx.update(contacts).set(patch).where(eq(contacts.id, contact.id)).returning();
    }

    // Funil de destino.
    let opportunityId: string | null = null;
    if (locked.pipelineKind === "sales") {
      // Closer recebe no próprio Kanban (etapa de mesmo tipo da escolhida na integração); sem closer, funil padrão.
      const [am] = assignedTo ? await tx.select({ role: memberships.role }).from(memberships).where(and(eq(memberships.orgId, form.orgId), eq(memberships.userId, assignedTo))) : [];
      const closerId = am && am.role !== "seller" ? assignedTo : null;
      const sales = closerId ? await closerPipeline(form.orgId, closerId, tx) : await getPipeline(form.orgId, "sales", tx);
      const list = await tx.select().from(pipelineStages).where(and(eq(pipelineStages.pipelineId, sales.id), isNull(pipelineStages.archivedAt))).orderBy(asc(pipelineStages.position));
      const [chosen] = locked.salesStageId ? await tx.select().from(pipelineStages).where(eq(pipelineStages.id, locked.salesStageId)) : [];
      const wanted = chosen && !["won", "lost"].includes(chosen.stageType) ? chosen.stageType : "entry";
      const stage = list.find((x) => x.id === chosen?.id) ?? list.find((x) => x.stageType === wanted) ?? list.find((x) => x.stageType === "entry") ?? list[0];
      if (stage) {
        const [open] = await tx.select({ id: opportunities.id }).from(opportunities).where(and(eq(opportunities.contactId, contact.id), eq(opportunities.status, "open")));
        if (open) opportunityId = open.id;
        else {
          const [o] = await tx
            .insert(opportunities)
            .values({ orgId: form.orgId, contactId: contact.id, title: `${prod?.name ?? locked.name} — ${input.name}`, product: prod?.name ?? null, productId: productId ?? null, valueCents: 0, closerId, sellerId: closerId ? null : assignedTo, stageId: stage.id })
            .returning();
          await tx.insert(stageHistory).values({ orgId: form.orgId, entityType: "opportunity", entityId: o.id, contactId: contact.id, toStageId: stage.id, toStageName: stage.name, reason: `Lead · ${locked.name}` });
          opportunityId = o.id;
        }
      }
    }
    // Social Seller: o lead NÃO entra sozinho no Kanban. A etapa da integração fica como sugestão
    // e o cartão só é criado quando alguém aperta "Adicionar ao CRM do Social Seller" (addLeadToBoard).
    const suggestedStageId = locked.pipelineKind !== "sales" ? (locked.stageId ?? null) : null;

    const [lead] = await tx
      .insert(leads)
      .values({
        orgId: form.orgId,
        formId: form.id,
        contactId: contact.id,
        assignedTo,
        name: input.name,
        phone: input.phone,
        email: input.email,
        instagram: input.instagram,
        answers: input.answers,
        custom: input.custom ?? {},
        preferredAt: input.preferredAt,
        preferredText: input.preferredText,
        utm: input.utm,
        channel: input.channel,
        sourceId: locked.sourceId,
        campaign: locked.campaign ?? input.utm.utm_campaign ?? input.utm.campaign_name ?? null,
        adChannel: locked.channel,
        partner: locked.partner,
        adName: locked.adName ?? input.utm.ad_name ?? input.utm.utm_content ?? null,
        productId,
        opportunityId,
        suggestedStageId,
      })
      .returning();
    await tx.insert(contactTouchpoints).values({
      orgId: form.orgId,
      contactId: contact.id,
      sourceId: locked.sourceId,
      kind: "form",
      campaign: lead.campaign,
      channel: locked.channel,
      partner: locked.partner,
      adName: lead.adName,
      integrationId: form.id,
      integrationName: locked.name,
      leadId: lead.id,
      utm: input.utm,
      note: opts.touchpointNote ?? (returning ? `Preencheu novamente “${locked.name}”.` : `Preencheu “${locked.name}”.`),
      occurredAt: now,
    });
    await tx.update(leadForms).set({ lastLeadAt: now, lastError: null, lastErrorAt: null }).where(eq(leadForms.id, form.id));
    await logIntegration(tx, locked, {
      event: returning ? "Lead atualizado" : "Lead recebido",
      result: "success",
      message: returning ? `${input.name} já estava no CRM: contato atualizado e novo envio registrado na jornada.` : `${input.name} entrou no CRM.`,
      leadId: lead.id,
      detected: { nome: !!input.name, telefone: !!input.phone, email: !!input.email, instagram: !!input.instagram, origem: !!locked.sourceId, utm: Object.keys(input.utm).length > 0 },
    });
    await audit(tx, { orgId: form.orgId, userId: null }, "lead.received", "lead", lead.id, { formId: form.id, channel: input.channel, assignedTo, returning });
    if (opts.afterInsert) await opts.afterInsert(tx, { lead, contactId: contact.id, returning });
    return { lead, contactCreated, returning, sourceName: src?.name ?? null, productName: prod?.name ?? null };
  });

  // Notificação somente para quem recebeu o lead.
  const body = [sourceName, form.name, productName, input.preferredAt ? `prefere ${fmtWhen(input.preferredAt)}` : null].filter(Boolean).join(" · ");
  if (opts.notify === false) {
    // Destino sem prioridade comercial: ninguém é avisado.
  } else if (lead.assignedTo) {
    await notifyUser({ orgId: form.orgId, userId: lead.assignedTo, type: "lead.new", title: returning ? `Lead voltou: ${lead.name}` : `Novo lead: ${lead.name}`, body, link: `/leads?lead=${lead.id}` }).catch((e) => logger.warn("Falha ao avisar o responsável", e));
  } else {
    // Ninguém para receber: avisa os administradores para o lead não se perder.
    const admins = await db.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.orgId, form.orgId), eq(memberships.role, "admin"), eq(memberships.status, "active")));
    for (const a of admins) {
      await notifyUser({ orgId: form.orgId, userId: a.userId, type: "lead.unassigned", title: `Lead sem responsável: ${lead.name}`, body: `${form.name} · ninguém ativo para receber`, link: `/leads?lead=${lead.id}` }).catch(() => {});
    }
  }
  await publish({ orgId: form.orgId, topic: "leads", entityId: lead.id, ownerIds: [lead.assignedTo] });
  if (lead.opportunityId) {
    await publish({ orgId: form.orgId, topic: "opportunities", entityId: lead.contactId, ownerIds: [lead.assignedTo] });
  } else if (contactCreated) {
    await publish({ orgId: form.orgId, topic: "board", entityId: lead.contactId, ownerIds: [lead.assignedTo] });
  }
  return lead;
}

function fmtWhen(d: Date) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Bahia", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
}

// ---------- Leads (operação) ----------

// ---------- Lead score por produto ----------

/**
 * Última aplicação (quiz) do contato do lead: a do próprio lead primeiro, depois a mais recente.
 * Assim um lead que entrou por outra integração herda a classe de quem já respondeu o quiz.
 * Colunas com o nome da tabela escrito à mão (subconsulta em SELECT, ver Peculiaridades).
 */
const latestApplication = (cols: SQL) =>
  sql`(select ${cols} from quiz_submissions s where s.contact_id = ${sql.raw('"leads"."contact_id"')} and s.anonymized_at is null order by (s.lead_id = ${sql.raw('"leads"."id"')}) desc nulls last, (s.duplicate_of is null) desc, s.completed_at desc limit 1)`;

/** Produto final da aplicação (ajuste manual da resposta, senão a sugestão). Mesmas regras de `classFromProduct`. */
const appProduct = sql`coalesce(s.override->>'productId', s.product_id, '') || ' ' || coalesce(s.override->>'productLabel', s.product_label, '')`;
const autoClassSql = latestApplication(
  sql`case when ${appProduct} ~* 'mentoria' then 'MENTORIA' when ${appProduct} ~* 'consultoria' then 'CONSULTORIA' when ${appProduct} ~* '(sess|sprint)' then 'SESSAO' when ${appProduct} ~* '(nutri|n[aã]o.{0,6}icp)' then 'NAO_ICP' end`,
);
/** Classe valendo: a escolhida à mão no lead, senão a do quiz. */
export const leadClassSql = sql<LeadClass | null>`coalesce(${sql.raw('"leads"."score_class"')}, ${autoClassSql})`;

/** Faixa de faturamento respondida na aplicação (id da alternativa). */
const revenueSql = latestApplication(sql`coalesce(s.answers->>'monthly_revenue_range', s.answers->>'faturamento')`);
/** O contato do lead tem cartão ativo (não automático) no Kanban do Social Seller: o lead "saiu" de Leads e está com um SDR. */
const inKanbanSql = sql`exists (select 1 from relationship_entries re where re.contact_id = ${sql.raw('"leads"."contact_id"')} and re.closed_at is null and not re.auto_created)`;
const WORK_STATUSES = ["new", "contacted", "no_answer"] as const;

/**
 * TOP 20 Leads: para atender, faturamento de R$ 10 mil para cima e fora de "Não é nosso ICP".
 * Ordem: maior pontuação do quiz primeiro.
 */
const topLeadsConds = () => [
  inArray(leads.status, [...WORK_STATUSES]),
  sql`not ${inKanbanSql}`,
  sql`${revenueSql} in (${sql.join(TOP_REVENUE_OPTIONS.map((o) => sql`${o}`), sql`, `)})`,
  sql`${leadClassSql} is distinct from 'NAO_ICP'`,
];

export const listLeadsSchema = z.object({
  /** top20 = TOP 20 Leads (melhores para entrar em contato). */
  status: z.enum(["new", "contacted", "scheduled", "no_answer", "disqualified", "all", "open", "top20", "kanban"]).default("open"),
  /** Lead score por produto (none = a classificar). */
  classe: z.enum(LEAD_CLASS_FILTERS).optional(),
  formId: z.string().uuid().optional(),
  assignedTo: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  /** Fonte de tráfego (origem do lead) ou "none" (sem origem). */
  fonte: z.union([z.string().uuid(), z.literal("none")]).optional(),
  periodo: z.enum(LEAD_PERIODS).optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
});

/** Início do período (últimos N dias contando hoje, no fuso da organização); back=1 dá o período anterior. */
function periodStartSql(periodo: Exclude<LeadPeriod, "all">, tz: string, back = 0) {
  const days = PERIOD_DAYS[periodo] * (back + 1) - 1;
  return sql`((date_trunc('day', now() at time zone ${tz}) - make_interval(days => ${days})) at time zone ${tz})`;
}

function sourceCond(fonte: string) {
  return fonte === "none" ? isNull(leads.sourceId) : eq(leads.sourceId, fonte);
}

const PAGE = 30;

export async function listLeads(ctx: Ctx, f: z.infer<typeof listLeadsSchema>) {
  const conds: SQL[] = [leadScope(ctx)];
  const top = f.status === "top20";
  if (f.status === "open") conds.push(inArray(leads.status, [...WORK_STATUSES]), sql`not ${inKanbanSql}`);
  else if (f.status === "top20") conds.push(...topLeadsConds());
  else if (f.status === "kanban") conds.push(inKanbanSql);
  else if (f.status === "new" || f.status === "contacted" || f.status === "no_answer") conds.push(eq(leads.status, f.status), sql`not ${inKanbanSql}`);
  else if (f.status !== "all") conds.push(eq(leads.status, f.status));
  if (f.formId) conds.push(eq(leads.formId, f.formId));
  if (f.assignedTo && can(ctx, "data.all")) conds.push(eq(leads.assignedTo, f.assignedTo));
  if (f.fonte) conds.push(sourceCond(f.fonte));
  if (f.periodo && f.periodo !== "all") conds.push(gte(leads.createdAt, periodStartSql(f.periodo, ctx.org.timezone)));
  if (f.q) {
    const like = `%${f.q.replace(/[%_]/g, "")}%`;
    conds.push(or(ilike(leads.name, like), ilike(leads.email, like), ilike(leads.phone, like), ilike(leads.instagram, like))!);
  }
  // Contagem por classe respeita os outros filtros (situação, responsável, busca).
  const classCounts = await db
    .select({ cls: leadClassSql, n: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(...conds))
    .groupBy(sql`1`);
  if (f.classe) conds.push(f.classe === "none" ? sql`${leadClassSql} is null` : sql`${leadClassSql} = ${f.classe}`);
  const where = and(...conds);
  const rows = await db
    .select({
      id: leads.id,
      name: leads.name,
      phone: leads.phone,
      email: leads.email,
      instagram: leads.instagram,
      status: leads.status,
      createdAt: leads.createdAt,
      preferredAt: leads.preferredAt,
      preferredText: leads.preferredText,
      contactId: leads.contactId,
      assignedTo: leads.assignedTo,
      assignedName: users.name,
      formName: leadForms.name,
      utmCampaign: sql<string | null>`coalesce(${leads.campaign}, ${leads.utm}->>'utm_campaign')`,
      sourceName: leadSources.name,
      sourceColor: leadSources.color,
      productName: products.name,
      appointmentAt: appointments.startsAt,
      scoreClass: leadClassSql,
      scoreClassManual: sql<boolean>`${leads.scoreClass} is not null`,
      score: sql<number | null>`${latestApplication(sql`s.score`)}`,
      revenue: sql<string | null>`${revenueSql}`,
      boardOwnerName: sql<string | null>`case when ${inKanbanSql} then (select u.name from contacts c join users u on u.id = c.owner_id where c.id = ${sql.raw('"leads"."contact_id"')}) end`,
      boardStageName: sql<string | null>`case when ${inKanbanSql} then (select ps.name from relationship_entries re join pipeline_stages ps on ps.id = re.stage_id where re.contact_id = ${sql.raw('"leads"."contact_id"')} and re.closed_at is null and not re.auto_created limit 1) end`,
    })
    .from(leads)
    .leftJoin(users, eq(users.id, leads.assignedTo))
    .leftJoin(leadForms, eq(leadForms.id, leads.formId))
    .leftJoin(appointments, eq(appointments.id, leads.appointmentId))
    .leftJoin(leadSources, eq(leadSources.id, leads.sourceId))
    .leftJoin(products, eq(products.id, leads.productId))
    .where(where)
    .orderBy(...(top ? [sql`${latestApplication(sql`s.score`)} desc nulls last`, desc(leads.createdAt)] : [desc(leads.createdAt)]))
    .limit(top ? TOP_LEADS_LIMIT : PAGE)
    .offset(top ? 0 : (f.page - 1) * PAGE);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(leads).where(where);
  // Quem está no Kanban sai das abas de trabalho (novo, contatado, sem resposta); continua em Agendados, Descartados e Todos.
  const statusRows = await db
    .select({ status: leads.status, kanban: sql<boolean>`${inKanbanSql}`, n: sql<number>`count(*)::int` })
    .from(leads)
    .where(leadScope(ctx))
    .groupBy(leads.status, sql`2`);
  const counts: { status: string; n: number }[] = [];
  let kanbanCount = 0;
  let allCount = 0;
  for (const r of statusRows) {
    allCount += r.n;
    if (r.kanban) kanbanCount += r.n;
    if (r.kanban && (WORK_STATUSES as readonly string[]).includes(r.status)) continue;
    const c = counts.find((x) => x.status === r.status);
    if (c) c.n += r.n;
    else counts.push({ status: r.status, n: r.n });
  }
  const [{ top20 }] = await db
    .select({ top20: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(leadScope(ctx), ...topLeadsConds()));
  return {
    rows,
    total: top ? Math.min(total, TOP_LEADS_LIMIT) : total,
    page: top ? 1 : f.page,
    pageSize: top ? TOP_LEADS_LIMIT : PAGE,
    counts: { ...Object.fromEntries(counts.map((c) => [c.status, c.n])), kanban: kanbanCount } as Record<string, number>,
    /** Todos os leads visíveis (a soma de `counts` não serve: `kanban` repete leads de outros status). */
    allCount,
    topCount: Math.min(top20, TOP_LEADS_LIMIT),
    classCounts: Object.fromEntries(classCounts.map((c) => [c.cls ?? "none", c.n])) as Record<string, number>,
  };
}

// ---------- Gráfico: leads por fonte de tráfego ----------

export const leadSourceStatsSchema = z.object({
  periodo: z.enum(LEAD_PERIODS).default("30d"),
  classe: z.enum(LEAD_CLASS_FILTERS).optional(),
  assignedTo: z.string().uuid().optional(),
});

type BucketUnit = "day" | "week" | "month";

/**
 * Quantos leads vieram de cada origem no período (com o período anterior para comparar)
 * e a evolução no tempo, por origem. Respeita lead score e responsável; a situação do lead não entra.
 */
export async function leadSourceStats(ctx: Ctx, f: z.infer<typeof leadSourceStatsSchema>) {
  const tz = ctx.org.timezone;
  const base: SQL[] = [leadScope(ctx)];
  if (f.assignedTo && can(ctx, "data.all")) base.push(eq(leads.assignedTo, f.assignedTo));
  if (f.classe) base.push(f.classe === "none" ? sql`${leadClassSql} is null` : sql`${leadClassSql} = ${f.classe}`);

  let start: SQL | null = null;
  let unit: BucketUnit = "day";
  if (f.periodo !== "all") {
    start = periodStartSql(f.periodo, tz);
    if (f.periodo === "90d") unit = "week";
  } else {
    const [{ first }] = await db
      .select({ first: sql<string | null>`min(${leads.createdAt})` })
      .from(leads)
      .where(and(...base));
    if (first) {
      const days = (Date.now() - new Date(first).getTime()) / 86400000;
      unit = days <= 31 ? "day" : days <= 180 ? "week" : "month";
      start = sql`${new Date(first).toISOString()}::timestamptz`;
    }
  }
  const inPeriod = and(...base, ...(start ? [gte(leads.createdAt, start)] : []));

  const bySource = await db
    .select({ id: leads.sourceId, name: leadSources.name, color: leadSources.color, n: sql<number>`count(*)::int` })
    .from(leads)
    .leftJoin(leadSources, eq(leadSources.id, leads.sourceId))
    .where(inPeriod)
    .groupBy(leads.sourceId, leadSources.name, leadSources.color);

  const previous = new Map<string, number>();
  if (f.periodo !== "all") {
    const prev = await db
      .select({ id: leads.sourceId, n: sql<number>`count(*)::int` })
      .from(leads)
      .where(and(...base, gte(leads.createdAt, periodStartSql(f.periodo, tz, 1)), lt(leads.createdAt, periodStartSql(f.periodo, tz))))
      .groupBy(leads.sourceId);
    for (const p of prev) previous.set(p.id ?? NO_SOURCE.id, p.n);
  }

  const sources = bySource
    .map((r) => ({
      id: r.id ?? NO_SOURCE.id,
      name: r.id ? (r.name ?? "Origem removida") : NO_SOURCE.name,
      color: r.id ? (r.color ?? "gray") : NO_SOURCE.color,
      n: r.n,
      previous: f.periodo === "all" ? null : (previous.get(r.id ?? NO_SOURCE.id) ?? 0),
    }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, "pt-BR"));

  // Evolução: um ponto por dia/semana/mês do período, inclusive os vazios.
  const bucket = sql`date_trunc(${unit}, ${leads.createdAt} at time zone ${tz})`;
  const series: { t: string; total: number; bySource: Record<string, number> }[] = [];
  if (start) {
    const slots = await db.execute<{ t: string }>(
      sql`select to_char(g, 'YYYY-MM-DD') as t from generate_series(date_trunc(${unit}, ${start} at time zone ${tz}), date_trunc(${unit}, now() at time zone ${tz}), ${`1 ${unit}`}::interval) g`,
    );
    const counts = await db
      .select({ t: sql<string>`to_char(${bucket}, 'YYYY-MM-DD')`, id: leads.sourceId, n: sql<number>`count(*)::int` })
      .from(leads)
      .where(inPeriod)
      .groupBy(sql`1`, leads.sourceId);
    const at = new Map(slots.map((s) => [s.t, { t: s.t, total: 0, bySource: {} as Record<string, number> }]));
    for (const c of counts) {
      const p = at.get(c.t);
      if (!p) continue;
      p.total += c.n;
      p.bySource[c.id ?? NO_SOURCE.id] = c.n;
    }
    series.push(...at.values());
  }

  return {
    periodo: f.periodo,
    unit,
    total: sources.reduce((a, s) => a + s.n, 0),
    previousTotal: f.periodo === "all" ? null : [...previous.values()].reduce((a, b) => a + b, 0),
    sources,
    series,
  };
}

async function getVisibleLead(ctx: Ctx, id: string) {
  const [l] = await db.select().from(leads).where(and(eq(leads.id, id), leadScope(ctx)));
  if (!l) throw notFound("Lead não encontrado.");
  return l;
}

export async function getLead(ctx: Ctx, id: string) {
  const l = await getVisibleLead(ctx, id);
  const [form] = l.formId ? await db.select({ name: leadForms.name, slug: leadForms.slug }).from(leadForms).where(eq(leadForms.id, l.formId)) : [];
  const [assigned] = l.assignedTo ? await db.select({ name: users.name }).from(users).where(eq(users.id, l.assignedTo)) : [];
  const [contact] = await db.select({ id: contacts.id, name: contacts.name, avatarUrl: contacts.avatarUrl, username: contacts.username, ownerId: contacts.ownerId }).from(contacts).where(eq(contacts.id, l.contactId));
  let appointment = null;
  if (l.appointmentId) {
    const [a] = await db
      .select({ id: appointments.id, startsAt: appointments.startsAt, endsAt: appointments.endsAt, status: appointments.status, title: appointments.title, ownerName: users.name, location: appointments.location })
      .from(appointments)
      .leftJoin(users, eq(users.id, appointments.ownerId))
      .where(eq(appointments.id, l.appointmentId));
    appointment = a ?? null;
  }
  const previous = await db
    .select({ id: leads.id, createdAt: leads.createdAt, formName: leadForms.name })
    .from(leads)
    .leftJoin(leadForms, eq(leadForms.id, leads.formId))
    .where(and(eq(leads.contactId, l.contactId), leadScope(ctx), sql`${leads.id} <> ${l.id}`))
    .orderBy(desc(leads.createdAt))
    .limit(5);
  const { contactJourney } = await import("./journey");
  const [src] = l.sourceId ? await db.select({ name: leadSources.name, color: leadSources.color }).from(leadSources).where(eq(leadSources.id, l.sourceId)) : [];
  const [prod] = l.productId ? await db.select({ name: products.name }).from(products).where(eq(products.id, l.productId)) : [];
  const fieldIds = Object.keys(l.custom ?? {});
  const fieldRows = fieldIds.length ? await db.select({ id: customFields.id, label: customFields.label }).from(customFields).where(inArray(customFields.id, fieldIds)).orderBy(asc(customFields.position)) : [];
  const leadScore = await leadScoreOf(l);
  return {
    ...l,
    formName: form?.name ?? null,
    assignedName: assigned?.name ?? null,
    contact,
    appointment,
    previous,
    source: src ?? null,
    productName: prod?.name ?? null,
    customValues: fieldRows.map((f) => ({ label: f.label, value: l.custom[f.id] })),
    journey: await contactJourney(ctx, l.contactId),
    leadScore,
    board: await boardStatusOf(ctx, l, leadScore.class),
  };
}

/** Lead score do lead: classe valendo, sugestão do quiz e quem ajustou à mão. */
async function leadScoreOf(l: typeof leads.$inferSelect) {
  const [app] = await db
    .select({
      id: quizSubmissions.id,
      formId: quizSubmissions.formId,
      formTitle: quizForms.name,
      score: quizSubmissions.score,
      tierLabel: quizSubmissions.tierLabel,
      productId: quizSubmissions.productId,
      productLabel: quizSubmissions.productLabel,
      override: quizSubmissions.override,
      needsReview: sql<boolean>`coalesce((${quizSubmissions.recommendation}->>'needsReview')::boolean, false) and ${quizSubmissions.override} is null`,
      completedAt: quizSubmissions.completedAt,
    })
    .from(quizSubmissions)
    .innerJoin(quizForms, eq(quizForms.id, quizSubmissions.formId))
    .where(and(eq(quizSubmissions.contactId, l.contactId), isNull(quizSubmissions.anonymizedAt)))
    .orderBy(sql`(${quizSubmissions.leadId} = ${l.id}) desc nulls last`, sql`(${quizSubmissions.duplicateOf} is null) desc`, desc(quizSubmissions.completedAt))
    .limit(1);
  const productLabel = app ? (app.override?.productLabel ?? app.productLabel) : null;
  const auto = app ? classFromProduct(app.override?.productId ?? app.productId, productLabel) : null;
  const [by] = l.scoreClassBy ? await db.select({ name: users.name }).from(users).where(eq(users.id, l.scoreClassBy)) : [];
  return {
    class: (l.scoreClass as LeadClass | null) ?? auto,
    auto,
    manual: l.scoreClass ? { byName: by?.name ?? null, at: l.scoreClassAt } : null,
    application: app ? { id: app.id, formId: app.formId, formTitle: app.formTitle, score: app.score, tierLabel: app.tierLabel, productLabel, needsReview: app.needsReview, completedAt: app.completedAt } : null,
  };
}

export const updateLeadSchema = z.object({
  status: z.enum(["new", "contacted", "no_answer", "disqualified"]).optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  /** Lead score por produto escolhido à mão; null = volta para a classificação do quiz. */
  scoreClass: z.enum(LEAD_CLASSES).nullable().optional(),
});

export async function updateLead(ctx: Ctx, id: string, input: z.infer<typeof updateLeadSchema>) {
  const l = await getVisibleLead(ctx, id);
  const patch: Partial<typeof leads.$inferInsert> = { updatedAt: new Date() };
  if (input.status) {
    if (l.status === "scheduled" && input.status !== "disqualified") throw invalid("Este lead já tem reunião. Altere a reunião em Agendamentos.");
    patch.status = input.status;
    if (input.status === "contacted" && !l.contactedAt) patch.contactedAt = new Date();
  }
  if (input.assignedTo !== undefined && input.assignedTo !== l.assignedTo) {
    if (!can(ctx, "contacts.assign")) throw forbidden("Somente gestores redistribuem leads.");
    if (input.assignedTo) {
      const [m] = await db.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, input.assignedTo), eq(memberships.status, "active")));
      if (!m) throw invalid("Responsável inválido.");
    }
    patch.assignedTo = input.assignedTo;
  }
  if (input.scoreClass !== undefined && input.scoreClass !== l.scoreClass) {
    patch.scoreClass = input.scoreClass;
    patch.scoreClassBy = input.scoreClass ? ctx.userId : null;
    patch.scoreClassAt = input.scoreClass ? new Date() : null;
  }
  const [u] = await db.update(leads).set(patch).where(eq(leads.id, l.id)).returning();
  if (input.status === "contacted" || input.status === "no_answer") {
    const { recordContactMade } = await import("./salesEvents");
    if (input.status === "contacted") await recordContactMade(ctx, l.contactId);
  }
  if (patch.assignedTo) {
    // Contato acompanha o lead quando ainda não tinha dono.
    await db.update(contacts).set({ ownerId: patch.assignedTo }).where(and(eq(contacts.id, l.contactId), isNull(contacts.ownerId)));
    if (patch.assignedTo !== ctx.userId) {
      await notifyUser({ orgId: ctx.orgId, userId: patch.assignedTo, type: "lead.new", title: `Lead para você: ${l.name}`, body: `Repassado por ${ctx.userName}`, link: `/leads?lead=${l.id}` });
    }
  }
  await audit(db, ctx, "lead.updated", "lead", l.id, { ...input });
  await publish({ orgId: ctx.orgId, topic: "leads", entityId: l.id, ownerIds: [l.assignedTo, u.assignedTo] });
  return u;
}

// ---------- Entrada manual no CRM do Social Seller ----------

/**
 * Etapa sugerida para o botão "Adicionar ao CRM": lead "Não é nosso ICP" → "Fora do ICP";
 * senão a etapa escolhida no formulário; senão "Novo interessado"; senão a primeira etapa.
 */
async function suggestedStageFor(ctx: Ctx, l: Pick<typeof leads.$inferSelect, "suggestedStageId">, cls: LeadClass | null) {
  const p = await getPipeline(ctx.orgId, "relationship");
  const stages = await db
    .select({ id: pipelineStages.id, key: pipelineStages.key, name: pipelineStages.name })
    .from(pipelineStages)
    .where(and(eq(pipelineStages.pipelineId, p.id), isNull(pipelineStages.archivedAt)))
    .orderBy(asc(pipelineStages.position));
  const byKey = (k: string) => stages.find((s) => s.key === k);
  return (cls === "NAO_ICP" ? byKey(FORA_DO_ICP_KEY) : undefined) ?? stages.find((s) => s.id === l.suggestedStageId) ?? byKey(NOVO_INTERESSADO_KEY) ?? stages[0] ?? null;
}

/** Situação do contato do lead no Kanban do Social Seller (cartão atual ou etapa sugerida). */
async function boardStatusOf(ctx: Ctx, l: typeof leads.$inferSelect, cls: LeadClass | null) {
  const entry = await activeEntryFor(l.contactId, ctx.orgId);
  const contato = await contatoStageFor(ctx.orgId);
  const [owner] = await db
    .select({ id: users.id, name: users.name })
    .from(contacts)
    .leftJoin(users, eq(users.id, contacts.ownerId))
    .where(eq(contacts.id, l.contactId));
  const ownerId = owner?.id ?? null;
  const ownerName = owner?.name ?? null;
  const contatoStageId = contato?.id ?? null;
  if (entry && !entry.autoCreated) return { inBoard: true as const, stageId: entry.stageId, stageName: entry.stageName, suggestedStageId: null, ownerId, ownerName, contatoStageId };
  const s = await suggestedStageFor(ctx, l, cls);
  return { inBoard: false as const, stageId: null, stageName: null, suggestedStageId: s?.id ?? null, ownerId, ownerName, contatoStageId };
}

/** Etapas ativas do Kanban do Social Seller, na ordem. */
async function activeRelationshipStages(orgId: string, tx: DbOrTx = db) {
  const p = await getPipeline(orgId, "relationship", tx);
  return tx
    .select()
    .from(pipelineStages)
    .where(and(eq(pipelineStages.pipelineId, p.id), isNull(pipelineStages.archivedAt)))
    .orderBy(asc(pipelineStages.position));
}

const isContato = (s: { key: string; name: string }, byKey: boolean) => (byKey ? s.key === CONTATO_KEY : s.name.trim().toLowerCase() === "contato");

/** Etapa "Contato": a de key `contato`, senão a de nome Contato (ativas). */
async function contatoStageFor(orgId: string, tx: DbOrTx = db) {
  const stages = await activeRelationshipStages(orgId, tx);
  return stages.find((s) => isContato(s, true)) ?? stages.find((s) => isContato(s, false)) ?? null;
}

export const addLeadToBoardSchema = z.object({ stageId: z.string().uuid().optional() });

/** "Adicionar ao CRM do Social Seller": único caminho para um lead de formulário entrar no Kanban. */
export async function addLeadToBoard(ctx: Ctx, id: string, input: z.infer<typeof addLeadToBoardSchema>) {
  const l = await getVisibleLead(ctx, id);
  const [form] = l.formId ? await db.select({ name: leadForms.name }).from(leadForms).where(eq(leadForms.id, l.formId)) : [];
  const stageId = input.stageId ?? (await suggestedStageFor(ctx, l, (await leadScoreOf(l)).class))?.id;
  if (!stageId) throw invalid("O Kanban do Social Seller não tem etapas.");
  const entry = await db.transaction(async (tx) => {
    const current = await activeEntryFor(l.contactId, ctx.orgId, tx);
    if (current && !current.autoCreated) throw new AppError("conflict", `Este lead já está no CRM do Social Seller, em “${current.stageName}”.`);
    if (current) {
      // Cartão antigo que entrou sozinho (mensagem/comentário): vira Lead de verdade.
      const [u] = await tx.update(relationshipEntries).set({ autoCreated: false, origin: "form", updatedAt: new Date() }).where(eq(relationshipEntries.id, current.id)).returning();
      return u;
    }
    const e = await addToBoard(ctx, l.contactId, stageId, tx, `Adicionado ao CRM · ${form?.name ?? "Lead"}`, { origin: "form", productId: l.productId, createdBy: ctx.userId });
    if (!e) throw new AppError("conflict", "Este lead já está no CRM do Social Seller.");
    // O contato acompanha o responsável do lead quando ainda não tinha dono.
    if (l.assignedTo) await tx.update(contacts).set({ ownerId: l.assignedTo }).where(and(eq(contacts.id, l.contactId), isNull(contacts.ownerId)));
    return e;
  });
  await audit(db, ctx, "lead.added_to_board", "lead", l.id, { stageId: entry.stageId });
  await publish({ orgId: ctx.orgId, topic: "board", entityId: l.contactId, ownerIds: [l.assignedTo] });
  await publish({ orgId: ctx.orgId, topic: "leads", entityId: l.id, ownerIds: [l.assignedTo] });
  return entry;
}

export const forwardLeadSchema = z.object({ sdrId: z.string().uuid().optional(), stageId: z.string().uuid().optional() });

/**
 * "Encaminhar para o Kanban": o SDR (por padrão quem chama) assume o lead, que vai para a etapa Contato do
 * Kanban do Social Seller, e deixa de aparecer nas abas de trabalho de Leads.
 */
export async function forwardLeadToKanban(ctx: Ctx, id: string, input: z.infer<typeof forwardLeadSchema>) {
  const l = await getVisibleLead(ctx, id);
  const sdrId = input.sdrId ?? ctx.userId;
  const manager = can(ctx, "contacts.assign");
  if (sdrId !== ctx.userId && !manager) throw forbidden("Somente gestores encaminham para o Kanban de outra pessoa.");
  const [sdr] = await db
    .select({ id: users.id, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, sdrId), eq(memberships.status, "active"), inArray(memberships.role, ["seller", "admin", "manager"])));
  if (!sdr) throw invalid("Escolha um SDR da equipe.");
  const stages = await activeRelationshipStages(ctx.orgId);
  let stage = input.stageId ? stages.find((s) => s.id === input.stageId) : (stages.find((s) => isContato(s, true)) ?? stages.find((s) => isContato(s, false)) ?? stages.find((s) => s.key === NOVO_INTERESSADO_KEY) ?? stages[0]);
  if (!stage) throw invalid(input.stageId ? "Etapa inválida." : "O Kanban do Social Seller não tem etapas.");
  const [form] = l.formId ? await db.select({ name: leadForms.name }).from(leadForms).where(eq(leadForms.id, l.formId)) : [];
  const now = new Date();

  const out = await db.transaction(async (tx) => {
    const [c] = await tx.select({ ownerId: contacts.ownerId }).from(contacts).where(eq(contacts.id, l.contactId)).for("update");
    const previousOwner = c?.ownerId ?? null;
    const current = await activeEntryFor(l.contactId, ctx.orgId, tx);
    let entryId: string;
    // Seller não toma o contato de outra pessoa (com ou sem cartão): só um gestor redistribui.
    if (previousOwner && previousOwner !== sdrId && !manager) {
      const [o] = await tx.select({ name: users.name }).from(users).where(eq(users.id, previousOwner));
      const who = o?.name ?? "outra pessoa";
      throw new AppError("conflict", current && !current.autoCreated ? `Este lead já está no Kanban de ${who}.` : `Este contato é de ${who}. Peça a um gestor para encaminhar.`);
    }
    if (current) {
      entryId = current.id;
      if (current.stageId !== stage.id || current.autoCreated) {
        const from = stages.find((s) => s.id === current.stageId);
        await tx
          .update(relationshipEntries)
          .set({ stageId: stage.id, version: current.version + 1, autoCreated: false, origin: current.origin ?? "form", updatedAt: now })
          .where(eq(relationshipEntries.id, current.id));
        await tx.insert(stageHistory).values({
          orgId: ctx.orgId,
          entityType: "relationship",
          entityId: current.id,
          contactId: l.contactId,
          fromStageId: current.stageId,
          toStageId: stage.id,
          fromStageName: from?.name ?? current.stageName,
          toStageName: stage.name,
          actorId: ctx.userId,
          reason: `Encaminhado para o Kanban de ${sdr.name}`,
        });
      }
    } else {
      const e = await addToBoard(ctx, l.contactId, stage.id, tx, `Encaminhado para o Kanban de ${sdr.name} · ${form?.name ?? "Lead"}`, { origin: "form", productId: l.productId, createdBy: ctx.userId });
      if (!e) throw new AppError("conflict", "Este lead já está no Kanban.");
      entryId = e.id;
    }
    // O SDR vira o responsável pelo contato (e pelas conversas que eram do anterior ou estavam sem dono).
    if (previousOwner !== sdrId) {
      await tx.update(contacts).set({ ownerId: sdrId, updatedAt: now }).where(eq(contacts.id, l.contactId));
      await tx
        .update(conversations)
        .set({ ownerId: sdrId })
        .where(and(eq(conversations.contactId, l.contactId), or(isNull(conversations.ownerId), previousOwner ? eq(conversations.ownerId, previousOwner) : undefined)));
    }
    const toContacted = l.status === "new" || l.status === "no_answer";
    await tx
      .update(leads)
      .set({ assignedTo: sdrId, updatedAt: now, ...(toContacted ? { status: "contacted" as const, contactedAt: l.contactedAt ?? now } : {}) })
      .where(eq(leads.id, l.id));
    return { entryId, previousOwner };
  });
  await audit(db, ctx, "lead.forwarded_to_kanban", "lead", l.id, { sdrId, stageId: stage.id, entryId: out.entryId });
  const ownerIds = [l.assignedTo, out.previousOwner, sdrId];
  await publish({ orgId: ctx.orgId, topic: "board", entityId: l.contactId, ownerIds });
  await publish({ orgId: ctx.orgId, topic: "leads", entityId: l.id, ownerIds });
  await publish({ orgId: ctx.orgId, topic: "contacts", entityId: l.contactId, ownerIds });
  if (sdrId !== ctx.userId) {
    await notifyUser({ orgId: ctx.orgId, userId: sdrId, type: "lead.new", title: `Lead no seu Kanban: ${l.name}`, link: `/social-seller?responsavel=${sdrId}` });
  }
  return { entryId: out.entryId, stageId: stage.id, stageName: stage.name, sdrId: sdr.id, sdrName: sdr.name };
}

export const scheduleLeadSchema = z
  .object({
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    title: z.string().trim().max(160).optional(),
    ownerId: z.string().uuid().nullish(),
    location: z.string().trim().max(300).nullish(),
    notes: z.string().max(2000).nullish(),
  })
  .refine((v) => v.endsAt > v.startsAt, { message: "O fim deve ser depois do início.", path: ["endsAt"] });

/** O social seller confirma a reunião com o lead: cria o agendamento e marca o lead como agendado. */
export async function scheduleLead(ctx: Ctx, id: string, input: z.infer<typeof scheduleLeadSchema>) {
  const l = await getVisibleLead(ctx, id);
  if (l.status === "scheduled" && l.appointmentId) {
    const [a] = await db.select({ status: appointments.status }).from(appointments).where(eq(appointments.id, l.appointmentId));
    if (a && a.status === "scheduled") throw new AppError("conflict", "Este lead já tem uma reunião marcada. Remarque em Agendamentos.");
  }
  if (input.startsAt.getTime() < Date.now() - 3600_000) throw invalid("Escolha um horário futuro.");
  const { createAppointment } = await import("./commercial");
  const a = await createAppointment(ctx, {
    contactId: l.contactId,
    ownerId: input.ownerId ?? ctx.userId,
    title: input.title || `Reunião com ${l.name}`,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    timezone: "America/Bahia",
    location: input.location ?? null,
    notes: input.notes ?? null,
  });
  await db.update(appointments).set({ leadId: l.id }).where(eq(appointments.id, a.id));
  const [u] = await db
    .update(leads)
    .set({ status: "scheduled", appointmentId: a.id, contactedAt: l.contactedAt ?? new Date(), updatedAt: new Date() })
    .where(eq(leads.id, l.id))
    .returning();
  await audit(db, ctx, "lead.scheduled", "lead", l.id, { appointmentId: a.id });
  await publish({ orgId: ctx.orgId, topic: "leads", entityId: l.id, ownerIds: [l.assignedTo] });
  return { lead: u, appointment: a };
}

/** Quantidade de leads novos do usuário (selo no menu). */
export async function newLeadCount(ctx: Ctx) {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(leadScope(ctx), eq(leads.status, "new"), sql`not ${inKanbanSql}`, can(ctx, "data.all") ? undefined : eq(leads.assignedTo, ctx.userId)));
  return n;
}
