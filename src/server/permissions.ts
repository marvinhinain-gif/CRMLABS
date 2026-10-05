import { and, eq, exists, isNull, or, sql, type SQL } from "drizzle-orm";
import { contacts, conversations, opportunities, tasks, appointments, socialComments, leads } from "./db/schema";
import type { Role } from "./db/schema";
import type { Ctx } from "./context";
import { forbidden } from "./errors";

export type Action =
  | "data.all"
  | "team.manage"
  | "integrations.manage"
  | "org.settings"
  | "pipeline.edit"
  | "contacts.assign"
  | "contacts.import"
  | "contacts.merge"
  | "savedReplies.manage"
  | "opportunity.decide"
  | "leads.manage";

const MATRIX: Record<Action, Role[]> = {
  "data.all": ["admin", "manager"],
  "team.manage": ["admin"],
  "integrations.manage": ["admin"],
  "org.settings": ["admin"],
  "pipeline.edit": ["admin", "manager"],
  "contacts.assign": ["admin", "manager"],
  "contacts.import": ["admin", "manager"],
  "contacts.merge": ["admin", "manager"],
  "savedReplies.manage": ["admin", "manager"],
  "opportunity.decide": ["admin", "manager", "closer"],
  "leads.manage": ["admin", "manager"],
};

export function can(ctx: Pick<Ctx, "role">, action: Action) {
  return MATRIX[action].includes(ctx.role);
}

export function assertCan(ctx: Pick<Ctx, "role">, action: Action, message?: string) {
  if (!can(ctx, action)) throw forbidden(message);
}

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrador",
  manager: "Gestor",
  seller: "Social seller",
  closer: "Closer",
};

/**
 * Condição SQL de visibilidade de contatos.
 * Aplicada em listas, buscas, quadro, painel, métricas e eventos de tempo real.
 */
export function contactScope(ctx: Ctx): SQL {
  const base = eq(contacts.orgId, ctx.orgId);
  if (can(ctx, "data.all")) return base;
  if (ctx.role === "closer") {
    return and(
      base,
      or(
        eq(contacts.ownerId, ctx.userId),
        exists(
          sql`(select 1 from ${opportunities} o where o.contact_id = ${contacts.id} and o.closer_id = ${ctx.userId})`,
        ),
      ),
    )!;
  }
  return and(base, eq(contacts.ownerId, ctx.userId))!;
}

/** Visibilidade de conversas (requer join com contacts). */
export function conversationScope(ctx: Ctx): SQL {
  const base = eq(conversations.orgId, ctx.orgId);
  if (can(ctx, "data.all")) return base;
  const options: SQL[] = [contactScope(ctx), eq(conversations.ownerId, ctx.userId)];
  if (ctx.org.sharedInbox && ctx.role === "seller") options.push(isNull(conversations.ownerId));
  return and(base, or(...options))!;
}

export function opportunityScope(ctx: Ctx): SQL {
  const base = eq(opportunities.orgId, ctx.orgId);
  if (can(ctx, "data.all")) return base;
  if (ctx.role === "closer") return and(base, eq(opportunities.closerId, ctx.userId))!;
  return and(
    base,
    exists(sql`(select 1 from ${contacts} c where c.id = ${opportunities.contactId} and c.owner_id = ${ctx.userId})`),
  )!;
}

export function taskScope(ctx: Ctx): SQL {
  const base = eq(tasks.orgId, ctx.orgId);
  if (can(ctx, "data.all")) return base;
  // Responsável ou quem atribuiu (para acompanhar a tarefa que passou a outra pessoa).
  return and(base, or(eq(tasks.ownerId, ctx.userId), eq(tasks.createdBy, ctx.userId)))!;
}

export function appointmentScope(ctx: Ctx): SQL {
  const base = eq(appointments.orgId, ctx.orgId);
  if (can(ctx, "data.all")) return base;
  return and(
    base,
    or(
      eq(appointments.ownerId, ctx.userId),
      exists(sql`(select 1 from ${contacts} c where c.id = ${appointments.contactId} and c.owner_id = ${ctx.userId})`),
    ),
  )!;
}

/** Comentários: visíveis se o contato vinculado é visível, ou sem contato na caixa compartilhada. */
export function commentScope(ctx: Ctx): SQL {
  const base = eq(socialComments.orgId, ctx.orgId);
  if (can(ctx, "data.all")) return base;
  const visibleContact = exists(
    sql`(select 1 from ${contacts} where ${contacts.id} = ${socialComments.contactId} and ${contactScope(ctx)})`,
  );
  if (ctx.org.sharedInbox) return and(base, or(visibleContact, isNull(socialComments.contactId)))!;
  return and(base, visibleContact)!;
}

/** Leads: gestores veem todos; social sellers veem os distribuídos a eles (ou de contatos seus). */
export function leadScope(ctx: Ctx): SQL {
  const base = eq(leads.orgId, ctx.orgId);
  if (can(ctx, "data.all")) return base;
  return and(
    base,
    or(
      eq(leads.assignedTo, ctx.userId),
      exists(sql`(select 1 from ${contacts} c where c.id = ${leads.contactId} and c.owner_id = ${ctx.userId})`),
      // Quando o lead chega ao closer (oportunidade ou reunião dele), o histórico vai junto.
      exists(sql`(select 1 from ${opportunities} o where o.contact_id = ${leads.contactId} and o.closer_id = ${ctx.userId})`),
      exists(sql`(select 1 from ${appointments} a where a.contact_id = ${leads.contactId} and a.owner_id = ${ctx.userId})`),
    ),
  )!;
}
