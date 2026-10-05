import { and, asc, desc, eq, gt, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "../db";
import {
  appointments,
  contactTouchpoints,
  contacts,
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
import { audit, cleanText, getPipeline, normalizeHandle, notifyUser } from "./common";
import { addToBoard } from "./board";
import { UTM_KEYS } from "../integrations/forms/normalize";

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
    .where(and(eq(leadForms.slug, slug.toLowerCase()), eq(leadForms.active, true)));
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
  const [form] = await db.select().from(leadForms).where(and(eq(leadForms.slug, slug.toLowerCase()), eq(leadForms.active, true)));
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
export async function ingestLead(form: Integration, input: LeadInput) {
  const now = new Date();
  const { lead, contactCreated, returning, sourceName, productName } = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(leadForms).where(eq(leadForms.id, form.id)).for("update");
    const { pool, fixed } = await candidates(tx, locked);
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
    if (!fixed && contact?.ownerId && locked.pipelineKind !== "sales") {
      const [m] = await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.orgId, form.orgId), eq(memberships.userId, contact.ownerId), eq(memberships.status, "active")));
      if (m) assignedTo = contact.ownerId;
    }
    if (!assignedTo && pool.length) {
      assignedTo = pool[locked.rotation % pool.length];
      if (!fixed) await tx.update(leadForms).set({ rotation: locked.rotation + 1 }).where(eq(leadForms.id, form.id));
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
      const sales = await getPipeline(form.orgId, "sales", tx);
      const [stage] = locked.salesStageId
        ? await tx.select().from(pipelineStages).where(and(eq(pipelineStages.id, locked.salesStageId), isNull(pipelineStages.archivedAt)))
        : await tx.select().from(pipelineStages).where(and(eq(pipelineStages.pipelineId, sales.id), isNull(pipelineStages.archivedAt))).orderBy(asc(pipelineStages.position)).limit(1);
      if (stage) {
        const [open] = await tx.select({ id: opportunities.id }).from(opportunities).where(and(eq(opportunities.contactId, contact.id), eq(opportunities.status, "open")));
        if (open) opportunityId = open.id;
        else {
          const [o] = await tx
            .insert(opportunities)
            .values({ orgId: form.orgId, contactId: contact.id, title: `${prod?.name ?? locked.name} — ${input.name}`, product: prod?.name ?? null, valueCents: 0, closerId: assignedTo, stageId: stage.id })
            .returning();
          await tx.insert(stageHistory).values({ orgId: form.orgId, entityType: "opportunity", entityId: o.id, contactId: contact.id, toStageId: stage.id, toStageName: stage.name, reason: `Lead · ${locked.name}` });
          opportunityId = o.id;
        }
      }
    } else if (locked.stageId) {
      const [onBoard] = await tx.select({ id: relationshipEntries.id }).from(relationshipEntries).where(and(eq(relationshipEntries.contactId, contact.id), isNull(relationshipEntries.closedAt)));
      if (!onBoard) {
        try {
          await addToBoard({ orgId: form.orgId, userId: null }, contact.id, locked.stageId, tx, `Lead · ${locked.name}`);
        } catch (e) {
          logger.warn("Etapa da integração indisponível; lead entrou sem cartão", e);
        }
      }
    }

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
      note: returning ? `Preencheu novamente “${locked.name}”.` : `Preencheu “${locked.name}”.`,
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
    return { lead, contactCreated, returning, sourceName: src?.name ?? null, productName: prod?.name ?? null };
  });

  // Notificação somente para quem recebeu o lead.
  const body = [sourceName, form.name, productName, input.preferredAt ? `prefere ${fmtWhen(input.preferredAt)}` : null].filter(Boolean).join(" · ");
  if (lead.assignedTo) {
    await notifyUser({ orgId: form.orgId, userId: lead.assignedTo, type: "lead.new", title: returning ? `Lead voltou: ${lead.name}` : `Novo lead: ${lead.name}`, body, link: `/leads?lead=${lead.id}` }).catch((e) => logger.warn("Falha ao avisar o responsável", e));
  } else {
    // Ninguém para receber: avisa os administradores para o lead não se perder.
    const admins = await db.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.orgId, form.orgId), eq(memberships.role, "admin"), eq(memberships.status, "active")));
    for (const a of admins) {
      await notifyUser({ orgId: form.orgId, userId: a.userId, type: "lead.unassigned", title: `Lead sem responsável: ${lead.name}`, body: `${form.name} · ninguém ativo para receber`, link: `/leads?lead=${lead.id}` }).catch(() => {});
    }
  }
  await publish({ orgId: form.orgId, topic: "leads", entityId: lead.id, ownerIds: [lead.assignedTo] });
  if (contactCreated || form.stageId || lead.opportunityId) {
    await publish({ orgId: form.orgId, topic: form.pipelineKind === "sales" ? "opportunities" : "board", entityId: lead.contactId, ownerIds: [lead.assignedTo] });
  }
  return lead;
}

function fmtWhen(d: Date) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Bahia", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
}

// ---------- Leads (operação) ----------

export const listLeadsSchema = z.object({
  status: z.enum(["new", "contacted", "scheduled", "no_answer", "disqualified", "all", "open"]).default("open"),
  formId: z.string().uuid().optional(),
  assignedTo: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
});

const PAGE = 30;

export async function listLeads(ctx: Ctx, f: z.infer<typeof listLeadsSchema>) {
  const conds: SQL[] = [leadScope(ctx)];
  if (f.status === "open") conds.push(inArray(leads.status, ["new", "contacted", "no_answer"]));
  else if (f.status !== "all") conds.push(eq(leads.status, f.status));
  if (f.formId) conds.push(eq(leads.formId, f.formId));
  if (f.assignedTo && can(ctx, "data.all")) conds.push(eq(leads.assignedTo, f.assignedTo));
  if (f.q) {
    const like = `%${f.q.replace(/[%_]/g, "")}%`;
    conds.push(or(ilike(leads.name, like), ilike(leads.email, like), ilike(leads.phone, like), ilike(leads.instagram, like))!);
  }
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
    })
    .from(leads)
    .leftJoin(users, eq(users.id, leads.assignedTo))
    .leftJoin(leadForms, eq(leadForms.id, leads.formId))
    .leftJoin(appointments, eq(appointments.id, leads.appointmentId))
    .leftJoin(leadSources, eq(leadSources.id, leads.sourceId))
    .leftJoin(products, eq(products.id, leads.productId))
    .where(where)
    .orderBy(desc(leads.createdAt))
    .limit(PAGE)
    .offset((f.page - 1) * PAGE);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(leads).where(where);
  const counts = await db
    .select({ status: leads.status, n: sql<number>`count(*)::int` })
    .from(leads)
    .where(leadScope(ctx))
    .groupBy(leads.status);
  return { rows, total, page: f.page, pageSize: PAGE, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) as Record<string, number> };
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
  };
}

export const updateLeadSchema = z.object({
  status: z.enum(["new", "contacted", "no_answer", "disqualified"]).optional(),
  assignedTo: z.string().uuid().nullable().optional(),
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
  const [u] = await db.update(leads).set(patch).where(eq(leads.id, l.id)).returning();
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
    .where(and(leadScope(ctx), eq(leads.status, "new"), can(ctx, "data.all") ? undefined : eq(leads.assignedTo, ctx.userId)));
  return n;
}
