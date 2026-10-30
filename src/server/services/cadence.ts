import { and, asc, desc, eq, gte, inArray, isNull, lt, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "../db";
import { cadenceActivities, cadenceSteps, contacts, pipelineStages, relationshipEntries, users } from "../db/schema";
import type { Ctx } from "../context";
import { assertCan, can, contactScope } from "../permissions";
import { AppError, forbidden, invalid, notFound } from "../errors";
import { publish } from "../realtime";
import { dayRange } from "../time";
import { cleanText } from "./common";
import {
  CADENCE_ACTION_PREFIX,
  CADENCE_CHANNELS,
  CADENCE_OUTCOMES,
  DEFAULT_CADENCE_STEPS,
  OUTCOME_EFFECT,
  type CadenceOutcome,
  type CadenceStatus,
} from "@/lib/cadence";

type StepRow = typeof cadenceSteps.$inferSelect;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Passos padrão para uma organização nova (chamado em createOrganization). */
export async function seedDefaultCadenceSteps(orgId: string, tx: DbOrTx = db) {
  await tx
    .insert(cadenceSteps)
    .values(DEFAULT_CADENCE_STEPS.map((s, i) => ({ orgId, key: s.key, name: s.name, channel: s.channel, waitDays: s.waitDays, script: s.script, position: i })))
    .onConflictDoNothing();
}

export async function listActiveSteps(orgId: string, tx: DbOrTx = db) {
  return tx
    .select()
    .from(cadenceSteps)
    .where(and(eq(cadenceSteps.orgId, orgId), isNull(cadenceSteps.archivedAt)))
    .orderBy(asc(cadenceSteps.position), asc(cadenceSteps.createdAt));
}

// ---------- Passos (edição por organização) ----------

export const saveStepsSchema = z.object({
  steps: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        name: z.string().trim().min(1, "Informe o nome do passo.").max(80),
        channel: z.enum(CADENCE_CHANNELS),
        waitDays: z.number().int().min(0).max(60),
        script: z.string().max(4000),
      }),
    )
    .min(1, "A cadência precisa ter ao menos um passo.")
    .max(20),
});

function slugify(name: string) {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "passo"
  );
}

export async function saveSteps(ctx: Ctx, input: z.infer<typeof saveStepsSchema>) {
  assertCan(ctx, "pipeline.edit");
  await db.transaction(async (tx) => {
    const all = await tx.select().from(cadenceSteps).where(eq(cadenceSteps.orgId, ctx.orgId)).for("update");
    const byId = new Map(all.map((s) => [s.id, s]));
    const keys = new Set(all.map((s) => s.key));
    const kept = new Set<string>();
    for (const [i, s] of input.steps.entries()) {
      const script = s.script.replace(/\u0000/g, "");
      if (s.id) {
        if (!byId.has(s.id)) throw invalid("Passo inválido.");
        if (kept.has(s.id)) throw invalid("Passo repetido.");
        kept.add(s.id);
        await tx.update(cadenceSteps).set({ name: s.name, channel: s.channel, waitDays: s.waitDays, script, position: i, archivedAt: null }).where(eq(cadenceSteps.id, s.id));
      } else {
        const base = slugify(s.name);
        let key = base;
        for (let n = 2; keys.has(key); n++) key = `${base}-${n}`;
        keys.add(key);
        await tx.insert(cadenceSteps).values({ orgId: ctx.orgId, key, name: s.name, channel: s.channel, waitDays: s.waitDays, script, position: i });
      }
    }
    // Nunca apaga: passos fora da lista apenas saem de uso.
    const removed = all.filter((s) => !kept.has(s.id) && !s.archivedAt).map((s) => s.id);
    if (removed.length) await tx.update(cadenceSteps).set({ archivedAt: new Date() }).where(inArray(cadenceSteps.id, removed));
  });
  return listActiveSteps(ctx.orgId);
}

// ---------- Contato / entrada ----------

async function loadEntry(ctx: Ctx, contactId: string, tx: DbOrTx, lock = false) {
  const q = tx
    .select({ entry: relationshipEntries, ownerId: contacts.ownerId, contactName: contacts.name })
    .from(relationshipEntries)
    .innerJoin(contacts, eq(contacts.id, relationshipEntries.contactId))
    .where(
      and(
        eq(relationshipEntries.contactId, contactId),
        eq(relationshipEntries.orgId, ctx.orgId),
        isNull(relationshipEntries.closedAt),
        contactScope(ctx),
      ),
    )
    .limit(1);
  const [row] = lock ? await q.for("update", { of: relationshipEntries }) : await q;
  return row ?? null;
}

async function assertContactVisible(ctx: Ctx, contactId: string) {
  const [c] = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, contactId), contactScope(ctx)));
  if (!c) throw notFound("Contato não encontrado.");
}

/** Próximo passo ativo depois de `current` (que pode já estar arquivado). */
function nextStepAfter(steps: StepRow[], current: StepRow | null) {
  if (!current) return steps[0] ?? null;
  if (current.archivedAt) return steps.find((s) => s.position >= current.position) ?? null;
  const i = steps.findIndex((s) => s.id === current.id);
  return i >= 0 ? (steps[i + 1] ?? null) : (steps.find((s) => s.position > current.position) ?? null);
}

/** Mantém contacts.next_action sincronizado (chip de prazo e filtros do Kanban). */
async function syncNextAction(tx: DbOrTx, contactId: string, status: CadenceStatus | null, stepName: string | null, dueAt: Date | null) {
  if (status === "active" && stepName) {
    await tx.update(contacts).set({ nextAction: `${CADENCE_ACTION_PREFIX} ${stepName}`, nextActionAt: dueAt, updatedAt: new Date() }).where(eq(contacts.id, contactId));
    return;
  }
  await tx
    .update(contacts)
    .set({ nextAction: null, nextActionAt: null, updatedAt: new Date() })
    .where(and(eq(contacts.id, contactId), sql`${contacts.nextAction} like ${CADENCE_ACTION_PREFIX + "%"}`));
}

export async function getContactCadence(ctx: Ctx, contactId: string) {
  await assertContactVisible(ctx, contactId);
  const found = await loadEntry(ctx, contactId, db);
  const steps = await listActiveSteps(ctx.orgId);
  let currentStep: StepRow | null = null;
  if (found?.entry.cadenceStepId) {
    currentStep = steps.find((s) => s.id === found.entry.cadenceStepId) ?? (await db.select().from(cadenceSteps).where(eq(cadenceSteps.id, found.entry.cadenceStepId)).then((r) => r[0] ?? null));
  }
  const activities = await db
    .select({
      id: cadenceActivities.id,
      outcome: cadenceActivities.outcome,
      note: cadenceActivities.note,
      stepName: cadenceActivities.stepName,
      actorName: users.name,
      createdAt: cadenceActivities.createdAt,
    })
    .from(cadenceActivities)
    .leftJoin(users, eq(users.id, cadenceActivities.actorId))
    .where(and(eq(cadenceActivities.contactId, contactId), eq(cadenceActivities.orgId, ctx.orgId)))
    .orderBy(desc(cadenceActivities.createdAt), desc(cadenceActivities.id))
    .limit(50);
  return {
    entry: found
      ? { id: found.entry.id, status: found.entry.cadenceStatus as CadenceStatus | null, stepId: found.entry.cadenceStepId, dueAt: found.entry.cadenceDueAt, startedAt: found.entry.cadenceStartedAt }
      : null,
    steps,
    currentStep,
    activities,
  };
}

export const cadenceActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({
    action: z.literal("log"),
    outcome: z.enum(CADENCE_OUTCOMES),
    note: z.string().max(2000).optional(),
    /** Passo que a tela mostrava: evita avançar duas vezes num clique duplo ou com um colega ao mesmo tempo. */
    expectedStepId: z.string().uuid().nullable().optional(),
  }),
  z.object({ action: z.literal("stop") }),
  z.object({ action: z.literal("set_step"), stepId: z.string().uuid() }),
]);
export type CadenceAction = z.infer<typeof cadenceActionSchema>;

export async function applyCadenceAction(ctx: Ctx, contactId: string, input: CadenceAction) {
  await assertContactVisible(ctx, contactId);
  let madeContact = false;
  const ownerId = await db.transaction(async (tx) => {
    const found = await loadEntry(ctx, contactId, tx, true);
    if (!found) throw notFound("Este contato não está no quadro do Social Seller.");
    const { entry } = found;
    const now = new Date();
    const steps = await listActiveSteps(ctx.orgId, tx);
    const current: StepRow | null = entry.cadenceStepId
      ? ((steps.find((s) => s.id === entry.cadenceStepId) ?? (await tx.select().from(cadenceSteps).where(eq(cadenceSteps.id, entry.cadenceStepId)).then((r) => r[0]))) ?? null)
      : null;
    const record = (outcome: string, step: StepRow | null, note?: string | null) =>
      tx.insert(cadenceActivities).values({
        orgId: ctx.orgId,
        contactId,
        entryId: entry.id,
        stepId: step?.id ?? null,
        stepName: step?.name ?? null,
        outcome,
        note: cleanText(note),
        actorId: ctx.userId,
      });
    const setEntry = (v: Partial<typeof relationshipEntries.$inferInsert>) =>
      tx.update(relationshipEntries).set({ ...v, updatedAt: now }).where(eq(relationshipEntries.id, entry.id));

    if (input.action === "log" && input.outcome !== "note" && input.expectedStepId !== undefined && input.expectedStepId !== entry.cadenceStepId) {
      throw new AppError("conflict", "Este lead já mudou de passo na cadência. A tela foi atualizada.");
    }

    if (input.action === "start") {
      const first = steps[0];
      if (!first) throw invalid("A cadência não tem passos. Cadastre ao menos um passo.");
      await setEntry({ cadenceStatus: "active", cadenceStepId: first.id, cadenceStartedAt: now, cadenceDueAt: now });
      await record("started", first);
      await syncNextAction(tx, contactId, "active", first.name, now);
    } else if (input.action === "stop") {
      if (!entry.cadenceStatus) throw new AppError("conflict", "A cadência deste contato não foi iniciada.");
      await setEntry({ cadenceStatus: null, cadenceStepId: null, cadenceDueAt: null });
      await record("stopped", current);
      await syncNextAction(tx, contactId, null, null, null);
    } else if (input.action === "set_step") {
      const step = steps.find((s) => s.id === input.stepId);
      if (!step) throw invalid("Passo inválido.");
      await setEntry({ cadenceStatus: "active", cadenceStepId: step.id, cadenceDueAt: now, cadenceStartedAt: entry.cadenceStartedAt ?? now });
      await record("step_changed", step);
      await syncNextAction(tx, contactId, "active", step.name, now);
    } else {
      const outcome: CadenceOutcome = input.outcome;
      const note = cleanText(input.note);
      if (outcome === "note") {
        if (!note) throw invalid("Escreva a anotação.");
        await record("note", current, note);
      } else {
        if (!entry.cadenceStatus) throw new AppError("conflict", "Inicie a cadência antes de registrar o resultado.");
        const effect = OUTCOME_EFFECT[outcome];
        let status: CadenceStatus = entry.cadenceStatus as CadenceStatus;
        let stepAfter = current;
        let due: Date | null = entry.cadenceDueAt;
        if (effect.kind === "advance") {
          const next = nextStepAfter(steps, current);
          if (next) {
            status = "active";
            stepAfter = next;
            due = new Date(now.getTime() + next.waitDays * DAY_MS);
          } else {
            status = "finished";
            due = null;
          }
        } else if (effect.kind === "status") {
          status = effect.status;
          due = null;
        }
        await setEntry({ cadenceStatus: status, cadenceStepId: stepAfter?.id ?? null, cadenceDueAt: due });
        await record(outcome, current, note);
        await syncNextAction(tx, contactId, status, stepAfter?.name ?? null, due);
        madeContact = outcome !== "not_interested";
      }
    }
    return found.ownerId;
  });
  if (madeContact) {
    // Melhor esforço: não bloqueia o registro se o evento comercial falhar.
    const { recordContactMade } = await import("./salesEvents");
    await recordContactMade(ctx, contactId);
  }
  await publish({ orgId: ctx.orgId, topic: "board", entityId: contactId, ownerIds: [ownerId] });
  return getContactCadence(ctx, contactId);
}

// ---------- Fila ----------

export const queueQuerySchema = z.object({
  view: z.enum(["due", "upcoming", "responded", "scheduled", "lost", "finished", "all"]).default("due"),
  ownerId: z.string().uuid().optional(),
});
export type QueueQuery = z.infer<typeof queueQuerySchema>;

const QUEUE_LIMIT = 200;

export async function getQueue(ctx: Ctx, f: QueueQuery) {
  const { start, end } = dayRange(new Date(), ctx.org.timezone);
  const startIso = sql`${start.toISOString()}::timestamptz`;
  const endIso = sql`${end.toISOString()}::timestamptz`;
  const base: SQL[] = [
    eq(relationshipEntries.orgId, ctx.orgId),
    isNull(relationshipEntries.closedAt),
    sql`${relationshipEntries.cadenceStatus} is not null`,
    contactScope(ctx),
    isNull(contacts.archivedAt),
    isNull(contacts.mergedIntoId),
  ];
  if (f.ownerId) {
    if (!can(ctx, "data.all") && f.ownerId !== ctx.userId) throw forbidden();
    base.push(eq(contacts.ownerId, f.ownerId));
  }
  const st = relationshipEntries.cadenceStatus;
  const due = relationshipEntries.cadenceDueAt;
  const viewCond: SQL | undefined =
    f.view === "due" ? and(eq(st, "active"), lt(due, end)) : f.view === "upcoming" ? and(eq(st, "active"), gte(due, end)) : f.view === "all" ? undefined : eq(st, f.view);

  const [steps, countRow] = await Promise.all([
    listActiveSteps(ctx.orgId),
    db
      .select({
        overdue: sql<number>`count(*) filter (where ${st} = 'active' and ${due} < ${startIso})::int`,
        today: sql<number>`count(*) filter (where ${st} = 'active' and ${due} >= ${startIso} and ${due} < ${endIso})::int`,
        upcoming: sql<number>`count(*) filter (where ${st} = 'active' and ${due} >= ${endIso})::int`,
        responded: sql<number>`count(*) filter (where ${st} = 'responded')::int`,
        scheduled: sql<number>`count(*) filter (where ${st} = 'scheduled')::int`,
        lost: sql<number>`count(*) filter (where ${st} = 'lost')::int`,
        finished: sql<number>`count(*) filter (where ${st} = 'finished')::int`,
      })
      .from(relationshipEntries)
      .innerJoin(contacts, eq(contacts.id, relationshipEntries.contactId))
      .where(and(...base)),
  ]);

  const rows = await db
    .select({
      entryId: relationshipEntries.id,
      contactId: contacts.id,
      name: contacts.name,
      username: contacts.username,
      avatarUrl: contacts.avatarUrl,
      phone: contacts.phone,
      ownerId: contacts.ownerId,
      ownerName: users.name,
      stageName: pipelineStages.name,
      stageColor: pipelineStages.color,
      status: relationshipEntries.cadenceStatus,
      stepId: relationshipEntries.cadenceStepId,
      stepName: cadenceSteps.name,
      stepChannel: cadenceSteps.channel,
      stepPosition: cadenceSteps.position,
      stepArchivedAt: cadenceSteps.archivedAt,
      dueAt: relationshipEntries.cadenceDueAt,
      startedAt: relationshipEntries.cadenceStartedAt,
    })
    .from(relationshipEntries)
    .innerJoin(contacts, eq(contacts.id, relationshipEntries.contactId))
    .innerJoin(pipelineStages, eq(pipelineStages.id, relationshipEntries.stageId))
    .leftJoin(users, eq(users.id, contacts.ownerId))
    .leftJoin(cadenceSteps, eq(cadenceSteps.id, relationshipEntries.cadenceStepId))
    .where(and(...base, viewCond))
    .orderBy(sql`${due} asc nulls last`, asc(contacts.name))
    .limit(QUEUE_LIMIT);

  const entryIds = rows.map((r) => r.entryId);
  const lastRows = entryIds.length
    ? await db
        .selectDistinctOn([cadenceActivities.entryId], {
          entryId: cadenceActivities.entryId,
          outcome: cadenceActivities.outcome,
          note: cadenceActivities.note,
          at: cadenceActivities.createdAt,
          actorName: users.name,
        })
        .from(cadenceActivities)
        .leftJoin(users, eq(users.id, cadenceActivities.actorId))
        .where(inArray(cadenceActivities.entryId, entryIds))
        .orderBy(cadenceActivities.entryId, desc(cadenceActivities.createdAt), desc(cadenceActivities.id))
    : [];
  const last = new Map(lastRows.map((l) => [l.entryId, l]));

  const items = rows.map(({ stepPosition, stepArchivedAt, ...r }) => {
    let stepIndex: number | null = null;
    if (r.stepId) {
      const i = steps.findIndex((s) => s.id === r.stepId);
      stepIndex = i >= 0 ? i + 1 : stepPosition != null && stepArchivedAt ? Math.min(steps.filter((s) => s.position < stepPosition).length + 1, Math.max(steps.length, 1)) : null;
    }
    const l = last.get(r.entryId);
    return {
      ...r,
      status: r.status as CadenceStatus,
      stepIndex,
      stepCount: steps.length,
      lastActivity: l ? { outcome: l.outcome, note: l.note, at: l.at, actorName: l.actorName } : null,
    };
  });
  return { items, counts: countRow[0] };
}
