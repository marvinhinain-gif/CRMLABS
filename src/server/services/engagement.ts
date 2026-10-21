/**
 * Top Engajados: quem mais interage com o Instagram conectado, só com ações que a API oficial
 * atribui a uma pessoa (ver src/lib/engagement.ts para o que entra e o que não entra no score).
 *
 * Armazenamento: `engagement_events` guarda uma linha por mensagem recebida ou comentário de terceiros,
 * coletada em segundo plano a partir das tabelas que webhooks e sincronização já preenchem (sem duplicar:
 * uma origem = uma interação, e os webhooks já chegam deduplicados por mid / id do comentário).
 * A coleta é incremental (cursor por ordem de gravação) e roda fora da fila de webhooks.
 * O ranking agrega só o período pedido sobre um índice (org, data); nada de recalcular o histórico.
 */
import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { channelIdentities, contacts, conversations, engagementEvents, engagementIcp, engagementSettings, messages, socialComments, socialPosts, users } from "../db/schema";
import type { Ctx } from "../context";
import { can, commentScope, conversationScope } from "../permissions";
import { AppError, forbidden, notFound } from "../errors";
import { publish } from "../realtime";
import { logger } from "../logger";
import { audit } from "./common";
import {
  CRM_STATUSES,
  DEFAULT_DAILY_CAP,
  DEFAULT_WEIGHTS,
  KIND_FILTERS,
  KINDS_BY_FILTER,
  PERIODS,
  TRACKED_KINDS,
  type CrmStatus,
  type EngagementKind,
  type EngagementPeriod,
  type KindFilter,
  type WeightKey,
} from "@/lib/engagement";

const DELETED_DM = "Mensagem apagada pelo remetente";
const RANK_SIZE = 15;

// ---------- Coleta (segundo plano) ----------

/** Tipo da interação a partir da mensagem recebida. Uma mensagem = uma ação (sem contar duas vezes). */
const messageKindSql = sql.raw(`case
  when coalesce(b.attachments, '[]'::jsonb) @> '[{"type":"story_mention"}]'::jsonb then 'story_mention'
  when coalesce(b.attachments, '[]'::jsonb) @> '[{"type":"story_reply"}]'::jsonb then 'story_reply'
  when exists (select 1 from jsonb_array_elements(coalesce(b.attachments, '[]'::jsonb)) a where a->>'type' in ('share', 'ig_post', 'ig_reel', 'reel')) then 'dm_share'
  else 'dm' end`);

async function ensureCursors() {
  await db.execute(sql`insert into engagement_cursors (source) values ('messages'), ('comments') on conflict do nothing`);
}

/** Próximo lote de mensagens recebidas (Direct) → interações. Retorna [lidas, gravadas por organização]. */
async function collectMessages(limit: number) {
  const rows = await db.execute<{ read: number; org_id: string | null; inserted: number }>(sql`
    with cur as (select last_at, last_id from engagement_cursors where source = 'messages'),
    b as (
      select m.id, m.org_id, m.sent_at, m.attachments, m.created_at, cv.account_id, cv.contact_id
      from messages m
      join conversations cv on cv.id = m.conversation_id
      where m.direction = 'in' and cv.channel = 'instagram'
        and (m.created_at, m.id) > (select coalesce(last_at, '-infinity'::timestamptz), coalesce(last_id, '00000000-0000-0000-0000-000000000000'::uuid) from cur)
      order by m.created_at, m.id
      limit ${limit}
    ),
    ins as (
      insert into engagement_events (org_id, account_id, actor_key, kind, occurred_at, message_id, username)
      select b.org_id, coalesce(b.account_id, ci.account_id), coalesce(ci.external_id, 'contact:' || b.contact_id), ${messageKindSql}, b.sent_at, b.id, ci.username
      from b
      left join lateral (
        select x.external_id, x.account_id, x.username from channel_identities x
        where x.contact_id = b.contact_id
        order by (x.account_id = b.account_id) desc nulls last, x.created_at
        limit 1
      ) ci on true
      on conflict do nothing
      returning org_id
    ),
    adv as (
      update engagement_cursors set last_at = l.created_at, last_id = l.id, updated_at = now()
      from (select created_at, id from b order by created_at desc, id desc limit 1) l
      where source = 'messages'
    )
    select (select count(*)::int from b) as read, i.org_id, count(*)::int as inserted from ins i group by i.org_id
    union all select (select count(*)::int from b), null, 0`);
  return summarize(rows as unknown as { read: number; org_id: string | null; inserted: number }[]);
}

/** Próximo lote de comentários de terceiros → interações. */
async function collectComments(limit: number) {
  const rows = await db.execute<{ read: number; org_id: string | null; inserted: number }>(sql`
    with cur as (select last_at, last_id from engagement_cursors where source = 'comments'),
    b as (
      select sc.id, sc.org_id, sc.account_id, sc.author_external_id, sc.author_username, sc.contact_id, sc.commented_at, sc.created_at
      from social_comments sc
      where not sc.is_own
        and (sc.created_at, sc.id) > (select coalesce(last_at, '-infinity'::timestamptz), coalesce(last_id, '00000000-0000-0000-0000-000000000000'::uuid) from cur)
      order by sc.created_at, sc.id
      limit ${limit}
    ),
    ins as (
      insert into engagement_events (org_id, account_id, actor_key, kind, occurred_at, comment_id, username)
      select b.org_id, b.account_id,
        coalesce(b.author_external_id, 'contact:' || b.contact_id, 'username:' || lower(b.author_username)),
        'comment', b.commented_at, b.id, lower(b.author_username)
      from b
      where coalesce(b.author_external_id, b.contact_id::text, b.author_username) is not null
      on conflict do nothing
      returning org_id
    ),
    adv as (
      update engagement_cursors set last_at = l.created_at, last_id = l.id, updated_at = now()
      from (select created_at, id from b order by created_at desc, id desc limit 1) l
      where source = 'comments'
    )
    select (select count(*)::int from b) as read, i.org_id, count(*)::int as inserted from ins i group by i.org_id
    union all select (select count(*)::int from b), null, 0`);
  return summarize(rows as unknown as { read: number; org_id: string | null; inserted: number }[]);
}

function summarize(rows: { read: number; org_id: string | null; inserted: number }[]) {
  const orgs = new Map<string, number>();
  for (const r of rows) if (r.org_id) orgs.set(r.org_id, (orgs.get(r.org_id) ?? 0) + Number(r.inserted));
  return { read: Number(rows[0]?.read ?? 0), orgs };
}

/**
 * Rede de segurança: uma gravação que terminou depois de o cursor passar (transação longa) entra aqui.
 * Olha só os últimos 15 minutos de gravação; o índice único impede duplicar.
 */
async function sweepRecent() {
  await db.execute(sql`
    insert into engagement_events (org_id, account_id, actor_key, kind, occurred_at, message_id, username)
    select b.org_id, coalesce(b.account_id, ci.account_id), coalesce(ci.external_id, 'contact:' || b.contact_id), ${messageKindSql}, b.sent_at, b.id, ci.username
    from (
      select m.id, m.org_id, m.sent_at, m.attachments, cv.account_id, cv.contact_id
      from messages m join conversations cv on cv.id = m.conversation_id
      where m.created_at > now() - interval '15 minutes' and m.direction = 'in' and cv.channel = 'instagram'
        and m.created_at <= (select coalesce(last_at, '-infinity'::timestamptz) from engagement_cursors where source = 'messages')
        and not exists (select 1 from engagement_events e where e.message_id = m.id)
    ) b
    left join lateral (
      select x.external_id, x.account_id, x.username from channel_identities x
      where x.contact_id = b.contact_id order by (x.account_id = b.account_id) desc nulls last, x.created_at limit 1
    ) ci on true
    on conflict do nothing`);
  await db.execute(sql`
    insert into engagement_events (org_id, account_id, actor_key, kind, occurred_at, comment_id, username)
    select sc.org_id, sc.account_id, coalesce(sc.author_external_id, 'contact:' || sc.contact_id, 'username:' || lower(sc.author_username)), 'comment', sc.commented_at, sc.id, lower(sc.author_username)
    from social_comments sc
    where sc.created_at > now() - interval '15 minutes' and not sc.is_own
      and sc.created_at <= (select coalesce(last_at, '-infinity'::timestamptz) from engagement_cursors where source = 'comments')
      and coalesce(sc.author_external_id, sc.contact_id::text, sc.author_username) is not null
      and not exists (select 1 from engagement_events e where e.comment_id = sc.id)
    on conflict do nothing`);
}

const gc = globalThis as unknown as { __engagementRun?: Promise<number> | null; __engagementAt?: number };

/**
 * Coleta incremental. Lotes pequenos e limitados por chamada: a importação do histórico do Direct
 * entra aos poucos, sem segurar o laço de segundo plano. Uma execução por vez neste processo.
 */
export function collectEngagement(opts: { batch?: number; maxBatches?: number } = {}): Promise<number> {
  if (gc.__engagementRun) return gc.__engagementRun;
  const batch = opts.batch ?? 2000;
  const maxBatches = opts.maxBatches ?? 2;
  const run = async () => {
    await ensureCursors();
    const touched = new Map<string, number>();
    let total = 0;
    for (const collect of [collectMessages, collectComments]) {
      for (let i = 0; i < maxBatches; i++) {
        const r = await collect(batch);
        for (const [org, n] of r.orgs) touched.set(org, (touched.get(org) ?? 0) + n);
        if (r.read < batch) break;
      }
    }
    await sweepRecent();
    for (const [orgId, n] of touched) {
      total += n;
      if (n) await publish({ orgId, topic: "engagement" });
    }
    gc.__engagementAt = Date.now();
    return total;
  };
  gc.__engagementRun = run().finally(() => {
    gc.__engagementRun = null;
  });
  return gc.__engagementRun;
}

/** Ao abrir a tela: completa o que chegou desde a última coleta (no máximo a cada 20 s). */
async function catchUp() {
  if (gc.__engagementAt && Date.now() - gc.__engagementAt < 20_000) return;
  await collectEngagement({ maxBatches: 1 }).catch((e) => logger.warn("Falha na coleta do Top Engajados", e));
}

// ---------- Configuração ----------

export type EngagementConfig = { weights: Record<WeightKey, number>; dailyCap: number; closersCanView: boolean; updatedAt: Date | null; updatedByName: string | null };

export async function getEngagementConfig(orgId: string): Promise<EngagementConfig> {
  const [row] = await db
    .select({ weights: engagementSettings.weights, dailyCap: engagementSettings.dailyCap, closersCanView: engagementSettings.closersCanView, updatedAt: engagementSettings.updatedAt, updatedByName: users.name })
    .from(engagementSettings)
    .leftJoin(users, eq(users.id, engagementSettings.updatedBy))
    .where(eq(engagementSettings.orgId, orgId));
  const weights = { ...DEFAULT_WEIGHTS };
  for (const k of Object.keys(weights) as WeightKey[]) {
    const v = row?.weights?.[k];
    if (typeof v === "number" && Number.isFinite(v)) weights[k] = v;
  }
  return { weights, dailyCap: row?.dailyCap ?? DEFAULT_DAILY_CAP, closersCanView: row?.closersCanView ?? false, updatedAt: row?.updatedAt ?? null, updatedByName: row?.updatedByName ?? null };
}

/** Admin, gestor e social seller veem; closer só com autorização do administrador. */
export async function canViewEngagement(ctx: Ctx) {
  if (ctx.role !== "closer") return true;
  return (await getEngagementConfig(ctx.orgId)).closersCanView;
}

async function assertCanView(ctx: Ctx) {
  if (!(await canViewEngagement(ctx))) throw forbidden("O administrador ainda não liberou o Top Engajados para closers.");
}

const weightValue = z.number().int().min(0).max(100);
export const engagementConfigSchema = z.object({
  weights: z.object(Object.fromEntries(TRACKED_KINDS.map((k) => [k, weightValue.optional()])) as Record<EngagementKind, z.ZodOptional<typeof weightValue>>).optional(),
  dailyCap: z.number().int().min(1).max(50).optional(),
  closersCanView: z.boolean().optional(),
});

/** Só o administrador altera pesos e critérios. Ações que a API não identifica não têm peso editável. */
export async function updateEngagementConfig(ctx: Ctx, input: z.infer<typeof engagementConfigSchema>) {
  if (!can(ctx, "org.settings")) throw forbidden("Somente o administrador altera as regras de pontuação.");
  const current = await getEngagementConfig(ctx.orgId);
  const weights: Record<string, number> = {};
  for (const k of TRACKED_KINDS) weights[k] = input.weights?.[k] ?? current.weights[k];
  const values = { weights, dailyCap: input.dailyCap ?? current.dailyCap, closersCanView: input.closersCanView ?? current.closersCanView, updatedBy: ctx.userId, updatedAt: new Date() };
  await db.insert(engagementSettings).values({ orgId: ctx.orgId, ...values }).onConflictDoUpdate({ target: engagementSettings.orgId, set: values });
  await audit(db, ctx, "engagement.config_updated", "organization", ctx.orgId, { weights, dailyCap: values.dailyCap, closersCanView: values.closersCanView });
  await publish({ orgId: ctx.orgId, topic: "engagement" });
  return getEngagementConfig(ctx.orgId);
}

// ---------- Ranking ----------

export const rankingSchema = z.object({
  period: z.enum(PERIODS).default("week"),
  kind: z.enum(KIND_FILTERS).default("all"),
  q: z.string().trim().max(80).optional(),
  /** in: ranking normal (sem quem não é ICP) · out: só quem foi marcado como "não é ICP". */
  icp: z.enum(["in", "out"]).default("in"),
});

type Totals = { people: number; interactions: number; comments: number; directs: number; outOfIcp: number };

export type RankedPerson = {
  key: string;
  position: number;
  score: number;
  interactions: number;
  capped: number;
  lastAt: string;
  counts: Record<EngagementKind, number>;
  contactId: string | null;
  name: string | null;
  username: string | null;
  avatarUrl: string | null;
  ownerId: string | null;
  ownerName: string | null;
  status: CrmStatus;
  /** ICP marcado pela equipe: "yes" é ICP, "no" não é (fica fora do ranking), null ainda não classificado. */
  icp: IcpMark;
};

export type IcpMark = "yes" | "no" | null;

function periodStart(period: EngagementPeriod, tz: string) {
  const unit = { today: "day", week: "week", month: "month" }[period];
  return sql`(date_trunc('${sql.raw(unit)}', now() at time zone ${tz}) at time zone ${tz})`;
}

/**
 * Agrega as interações do período por pessoa:
 *  1. por identidade (IGSID), com teto diário por tipo de ação (anti-spam);
 *  2. identidades do mesmo contato (mesclado ou com mais de um id) viram uma pessoa só;
 *  3. ordena pelo score das ações do filtro escolhido.
 * Interações apagadas pelo remetente e comentários ocultos/excluídos pela conta não pontuam.
 */
async function rank(ctx: Ctx, f: { period: EngagementPeriod; kind: KindFilter; q?: string; personKey?: string; limit: number; outOfIcp?: boolean }) {
  const cfg = await getEngagementConfig(ctx.orgId);
  const tz = ctx.org.timezone;
  const chosen = KINDS_BY_FILTER[f.kind];
  const cap = cfg.dailyCap;
  const kindCols = TRACKED_KINDS.map(
    (k) => sql`count(*) filter (where kind = ${k})::int as ${sql.raw(`n_${k}`)}, coalesce(sum(case when rn <= ${cap} then ${cfg.weights[k]} else 0 end) filter (where kind = ${k}), 0)::int as ${sql.raw(`s_${k}`)}`,
  );
  const sumCols = TRACKED_KINDS.map((k) => sql`sum(${sql.raw(`n_${k}`)})::int as ${sql.raw(`n_${k}`)}, sum(${sql.raw(`s_${k}`)})::int as ${sql.raw(`s_${k}`)}`);
  const fScore = sql.join(chosen.map((k) => sql.raw(`s_${k}`)), sql` + `);
  const fCount = sql.join(chosen.map((k) => sql.raw(`n_${k}`)), sql` + `);
  const fCapped = sql.join(chosen.map((k) => sql.raw(`c_${k}`)), sql` + `);
  const cappedCols = TRACKED_KINDS.map((k) => sql`count(*) filter (where kind = ${k} and rn > ${cap})::int as ${sql.raw(`c_${k}`)}`);
  const cappedSums = TRACKED_KINDS.map((k) => sql`sum(${sql.raw(`c_${k}`)})::int as ${sql.raw(`c_${k}`)}`);
  const like = f.q ? `%${f.q.replace(/^@/, "").replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;

  // Teto de tempo: uma consulta lenta nunca fica presa no banco nem se acumula com as atualizações da tela.
  const res = await db.transaction(async (tx) => {
    await tx.execute(sql`set local statement_timeout = '20s'`);
    return tx.execute(sql`
    with ev as (
      select e.actor_key, e.kind, e.occurred_at, e.username,
        row_number() over (partition by e.actor_key, e.kind, (e.occurred_at at time zone ${tz})::date order by e.occurred_at) as rn
      from engagement_events e
      left join messages m on m.id = e.message_id
      left join social_comments sc on sc.id = e.comment_id
      where e.org_id = ${ctx.orgId} and e.occurred_at >= ${periodStart(f.period, tz)}
        and (e.message_id is null or m.error is distinct from ${DELETED_DM})
        and (e.comment_id is null or (sc.deleted_at is null and sc.hidden_at is null))
    ),
    per_actor as (
      select ev.actor_key, max(occurred_at) as last_at,
        (select ei.is_icp from engagement_icp ei where ei.org_id = ${ctx.orgId} and ei.actor_key = ev.actor_key) as is_icp,
        (array_agg(username order by occurred_at desc) filter (where username is not null))[1] as username,
        ${sql.join(kindCols, sql`, `)}, ${sql.join(cappedCols, sql`, `)}
      from ev group by ev.actor_key
    ),
    mapped as (
      -- Identidade oficial → contato (pelo índice de channel_identities); conversa sem identidade → "contact:<id>".
      select a.*, coalesce(ct.root_id::text, a.actor_key) as person_key, ct.root_id as contact_id
      from per_actor a
      left join lateral (
        select ci.contact_id from channel_identities ci
        where ci.org_id = ${ctx.orgId} and ci.external_id = a.actor_key
        order by ci.created_at limit 1
      ) ci on true
      left join lateral (
        select coalesce(c.merged_into_id, c.id) as root_id from contacts c
        where c.org_id = ${ctx.orgId}
          and c.id = coalesce(ci.contact_id, case when a.actor_key like 'contact:%' then substr(a.actor_key, 9)::uuid end)
      ) ct on true
    ),
    people as (
      select person_key, max(contact_id::text)::uuid as contact_id, max(last_at) as last_at,
        (array_agg(username order by last_at desc) filter (where username is not null))[1] as username,
        array_agg(actor_key) as actor_keys,
        -- "Não é ICP" em qualquer identidade da pessoa prevalece.
        case when bool_or(is_icp = false) then 'no' when bool_or(is_icp) then 'yes' end as icp,
        ${sql.join(sumCols, sql`, `)}, ${sql.join(cappedSums, sql`, `)}
      from mapped group by person_key
    ),
    ranked as (
      select p.*, (${fScore}) as f_score, (${fCount}) as f_count, (${fCapped}) as f_capped,
        row_number() over (order by (${fScore}) desc, (${fCount}) desc, p.last_at desc, p.person_key) as pos
      from people p
      where (${fScore}) > 0 and ${f.outOfIcp ? sql`p.icp = 'no'` : sql`p.icp is distinct from 'no'`}
    ),
    lim as (
      select r.*, c.name, c.username as contact_username, c.avatar_url, c.owner_id
      from ranked r
      left join contacts c on c.id = r.contact_id
      where true
        ${f.personKey ? sql`and r.person_key = ${f.personKey}` : sql``}
        ${like ? sql`and (coalesce(c.name, '') ilike ${like} or coalesce(c.username, r.username, '') ilike ${like})` : sql``}
      order by r.pos
      limit ${f.limit}
    ),
    -- Status no CRM só para as linhas exibidas (depois do limite).
    top as (
      select l.*, u.name as owner_name,
        case
          when l.contact_id is null then 'none'
          when exists (select 1 from opportunities o where o.contact_id = l.contact_id and o.status = 'won') then 'client'
          when exists (select 1 from opportunities o where o.contact_id = l.contact_id and o.status = 'open') then 'closer'
          when exists (select 1 from relationship_entries re where re.contact_id = l.contact_id and re.closed_at is null and not re.auto_created)
            or exists (select 1 from leads le where le.contact_id = l.contact_id)
            or exists (select 1 from opportunities o where o.contact_id = l.contact_id) then 'lead'
          else 'none'
        end as status
      from lim l
      left join users u on u.id = l.owner_id
    )
    select
      (select json_build_object(
        'people', count(*),
        'interactions', coalesce(sum(${sql.join(TRACKED_KINDS.map((k) => sql.raw(`n_${k}`)), sql` + `)}), 0),
        'comments', coalesce(sum(n_comment), 0),
        'directs', coalesce(sum(n_dm + n_dm_share + n_story_reply + n_story_mention), 0),
        'outOfIcp', count(*) filter (where icp = 'no' and (${fScore}) > 0)
      ) from people) as totals,
      (select coalesce(json_agg(t order by t.pos), '[]'::json) from top t) as rows`);
  }).catch((e) => {
    if (/statement timeout|canceling statement/i.test(String((e as Error)?.message ?? e))) throw new AppError("rate_limited", "O ranking demorou demais para calcular. Tente de novo em instantes.");
    throw e;
  });
  const [row] = res as unknown as { totals: Totals; rows: Record<string, unknown>[] }[];
  const people: (RankedPerson & { actorKeys: string[] })[] = row.rows.map((r) => ({
    key: String(r.person_key),
    position: Number(r.pos),
    score: Number(r.f_score),
    interactions: Number(r.f_count),
    capped: Number(r.f_capped),
    lastAt: String(r.last_at),
    counts: Object.fromEntries(TRACKED_KINDS.map((k) => [k, Number(r[`n_${k}`] ?? 0)])) as Record<EngagementKind, number>,
    contactId: (r.contact_id as string | null) ?? null,
    name: (r.name as string | null) ?? null,
    username: ((r.contact_username as string | null) ?? (r.username as string | null))?.replace(/^@/, "") ?? null,
    avatarUrl: (r.avatar_url as string | null) ?? null,
    ownerId: (r.owner_id as string | null) ?? null,
    ownerName: (r.owner_name as string | null) ?? null,
    status: (CRM_STATUSES as readonly string[]).includes(String(r.status)) ? (r.status as CrmStatus) : "none",
    icp: r.icp === "yes" || r.icp === "no" ? r.icp : null,
    actorKeys: (r.actor_keys as string[]) ?? [],
  }));
  const t = row.totals;
  return { cfg, totals: { people: Number(t.people), interactions: Number(t.interactions), comments: Number(t.comments), directs: Number(t.directs), outOfIcp: Number(t.outOfIcp) }, people };
}

/**
 * Pode transformar em Lead daqui? Segue a regra do "Transformar em Lead" existente: gestores sempre;
 * social seller quando o contato é dele ou quando a pessoa ainda não tem contato (só comentou).
 * Contato sem responsável ou de outra pessoa da equipe fica com o gestor / com o responsável.
 */
function canTransform(ctx: Ctx, p: Pick<RankedPerson, "ownerId" | "status" | "contactId">) {
  if (p.status !== "none") return false;
  return can(ctx, "data.all") || !p.contactId || p.ownerId === ctx.userId;
}

export async function engagementRanking(ctx: Ctx, input: z.input<typeof rankingSchema>) {
  const f = rankingSchema.parse(input);
  await assertCanView(ctx);
  await catchUp();
  const { cfg, totals, people } = await rank(ctx, { ...f, limit: RANK_SIZE, outOfIcp: f.icp === "out" });
  // "Potenciais oportunidades": do Top 15 do filtro (sem busca, sem quem não é ICP), quem ainda não é Lead.
  const top = f.q || f.icp === "out" ? (await rank(ctx, { period: f.period, kind: f.kind, limit: RANK_SIZE })).people : people;
  return {
    period: f.period,
    kind: f.kind,
    totals: { ...totals, opportunities: top.filter((p) => p.status === "none").length },
    rows: people.map(({ actorKeys: _a, ...p }) => ({ ...p, canTransform: canTransform(ctx, p) })),
    weights: Object.fromEntries(TRACKED_KINDS.map((k) => [k, cfg.weights[k]])),
    dailyCap: cfg.dailyCap,
    canConfigure: can(ctx, "org.settings"),
    canClassifyIcp: canClassifyIcp(ctx),
  };
}

/** Quem trabalha a prospecção classifica ICP (administrador, gestor e social seller); closer não. */
function canClassifyIcp(ctx: Ctx) {
  return ctx.role !== "closer";
}

async function icpOf(ctx: Ctx, actorKeys: string[]): Promise<IcpMark> {
  if (!actorKeys.length) return null;
  const rows = await db.select({ isIcp: engagementIcp.isIcp }).from(engagementIcp).where(and(eq(engagementIcp.orgId, ctx.orgId), inArray(engagementIcp.actorKey, actorKeys)));
  return rows.some((r) => !r.isIcp) ? "no" : rows.some((r) => r.isIcp) ? "yes" : null;
}

export const icpSchema = z.object({ key: z.string().min(1).max(200), value: z.enum(["yes", "no"]).nullable() });

/**
 * Marca a pessoa como ICP, "não é ICP" (sai do Top 15 e a próxima pessoa sobe) ou limpa a marcação.
 * Vale para todas as identidades da pessoa e para qualquer período.
 */
export async function setEngagementIcp(ctx: Ctx, input: z.infer<typeof icpSchema>) {
  await assertCanView(ctx);
  if (!canClassifyIcp(ctx)) throw forbidden("Closers não classificam ICP no Top Engajados.");
  const keys = await actorKeysFor(ctx, input.key);
  const [known] = keys.length ? await db.select({ n: sql<number>`count(*)::int` }).from(engagementEvents).where(and(eq(engagementEvents.orgId, ctx.orgId), inArray(engagementEvents.actorKey, keys))) : [];
  if (!known?.n) throw notFound("Nenhuma interação identificada para esta pessoa.");
  await db.transaction(async (tx) => {
    if (input.value === null) {
      await tx.delete(engagementIcp).where(and(eq(engagementIcp.orgId, ctx.orgId), inArray(engagementIcp.actorKey, keys)));
    } else {
      const values = keys.map((actorKey) => ({ orgId: ctx.orgId, actorKey, isIcp: input.value === "yes", decidedBy: ctx.userId, decidedAt: new Date() }));
      await tx.insert(engagementIcp).values(values).onConflictDoUpdate({ target: [engagementIcp.orgId, engagementIcp.actorKey], set: { isIcp: input.value === "yes", decidedBy: ctx.userId, decidedAt: new Date() } });
    }
    await audit(tx, ctx, "engagement.icp_set", "engagement_person", null, { key: input.key, value: input.value });
  });
  await publish({ orgId: ctx.orgId, topic: "engagement" });
  return { key: input.key, icp: input.value };
}

// ---------- Perfil detalhado ----------

export const personSchema = rankingSchema.omit({ q: true, icp: true }).extend({ key: z.string().min(1).max(200) });

export async function engagementPerson(ctx: Ctx, f: z.infer<typeof personSchema>) {
  await assertCanView(ctx);
  let [person] = (await rank(ctx, { period: f.period, kind: f.kind, personKey: f.key, limit: 1 })).people;
  person ??= (await rank(ctx, { period: f.period, kind: f.kind, personKey: f.key, limit: 1, outOfIcp: true })).people[0];
  const actorKeys = person ? person.actorKeys : await actorKeysFor(ctx, f.key);
  if (!actorKeys.length) throw notFound("Nenhuma interação identificada para esta pessoa.");
  const base = person ?? (await describePerson(ctx, f.key));

  const kinds = KINDS_BY_FILTER[f.kind];
  const tz = ctx.org.timezone;
  const scopeDm = conversationScope(ctx);
  const scopeComment = commentScope(ctx);
  const rows = await db
    .select({
      id: engagementEvents.id,
      kind: engagementEvents.kind,
      occurredAt: engagementEvents.occurredAt,
      messageBody: messages.body,
      messageError: messages.error,
      attachments: messages.attachments,
      conversationId: messages.conversationId,
      dmVisible: sql<boolean>`(${conversations.id} is not null and ${contacts.id} is not null and ${scopeDm})`,
      commentId: socialComments.id,
      commentText: socialComments.text,
      commentHidden: sql<boolean>`(${socialComments.hiddenAt} is not null or ${socialComments.deletedAt} is not null)`,
      commentVisible: sql<boolean>`(${socialComments.id} is not null and ${scopeComment})`,
      postId: socialPosts.id,
      postCaption: socialPosts.caption,
      postType: socialPosts.mediaType,
      postPermalink: socialPosts.permalink,
      postThumb: socialPosts.thumbnailUrl,
    })
    .from(engagementEvents)
    .leftJoin(messages, eq(messages.id, engagementEvents.messageId))
    .leftJoin(conversations, eq(conversations.id, messages.conversationId))
    .leftJoin(contacts, eq(contacts.id, conversations.contactId))
    .leftJoin(socialComments, eq(socialComments.id, engagementEvents.commentId))
    .leftJoin(socialPosts, eq(socialPosts.id, socialComments.postId))
    .where(
      and(
        eq(engagementEvents.orgId, ctx.orgId),
        inArray(engagementEvents.actorKey, actorKeys),
        inArray(engagementEvents.kind, kinds),
        sql`${engagementEvents.occurredAt} >= ${periodStart(f.period, tz)}`,
      ),
    )
    .orderBy(sql`${engagementEvents.occurredAt} desc`)
    .limit(150);

  const [span] = await db
    .select({ first: sql<string | null>`min(${engagementEvents.occurredAt})`, last: sql<string | null>`max(${engagementEvents.occurredAt})` })
    .from(engagementEvents)
    .where(and(eq(engagementEvents.orgId, ctx.orgId), inArray(engagementEvents.actorKey, actorKeys)));

  const activities = rows.map((r) => {
    const deleted = r.messageError === DELETED_DM;
    const story = (r.attachments ?? []).find((a) => a.type === "story_reply" || a.type === "story_mention");
    const share = (r.attachments ?? []).find((a) => ["share", "ig_post", "ig_reel", "reel"].includes(a.type));
    const isComment = r.kind === "comment";
    const visible = isComment ? r.commentVisible : r.dmVisible;
    return {
      id: r.id,
      kind: r.kind as EngagementKind,
      at: r.occurredAt,
      /** Conteúdo só para quem já pode ver a conversa/comentário no CRM. */
      text: visible ? ((isComment ? r.commentText : r.messageBody) ?? null) : null,
      restricted: !visible,
      excluded: deleted || (isComment && r.commentHidden),
      excludedReason: deleted ? "Apagada pelo remetente" : isComment && r.commentHidden ? "Comentário oculto ou excluído" : null,
      post: isComment && r.postId ? { caption: r.postCaption, type: r.postType, permalink: r.postPermalink, thumbnailUrl: r.postThumb } : null,
      /** Abrir a interação original: dentro do CRM (quando visível) e no Instagram (publicação pública). */
      link: visible ? (isComment ? (r.postId ? `/instagram?aba=comentarios&post=${r.postId}&comentario=${r.commentId}` : null) : `/instagram?aba=directs&c=${r.conversationId}`) : null,
      externalUrl: isComment ? (r.postPermalink ?? null) : visible ? (story?.url ?? share?.url ?? null) : null,
      externalLabel: isComment ? "Ver no Instagram" : story ? "Abrir Story (link temporário)" : share ? "Abrir publicação" : null,
    };
  });

  return {
    ...base,
    icp: await icpOf(ctx, actorKeys),
    canClassifyIcp: canClassifyIcp(ctx),
    canTransform: canTransform(ctx, base),
    firstAt: span?.first ?? null,
    lastAt: span?.last ?? base.lastAt,
    /** Posição entre quem conta no ranking (quem não é ICP não ocupa vaga). */
    inRanking: !!person && person.icp !== "no" && person.position <= RANK_SIZE,
    activities,
  };
}

/** IGSIDs/chaves de uma pessoa: contato → identidades + conversas sem identidade; senão a própria chave. */
async function actorKeysFor(ctx: Ctx, key: string) {
  if (/^[0-9a-f-]{36}$/i.test(key)) {
    const ids = await db.select({ ext: channelIdentities.externalId }).from(channelIdentities).where(and(eq(channelIdentities.orgId, ctx.orgId), eq(channelIdentities.contactId, key)));
    const merged = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.orgId, ctx.orgId), or(eq(contacts.id, key), eq(contacts.mergedIntoId, key))));
    return [...ids.map((i) => i.ext), ...merged.map((m) => `contact:${m.id}`)];
  }
  return [key];
}

async function describePerson(ctx: Ctx, key: string): Promise<RankedPerson> {
  const empty = Object.fromEntries(TRACKED_KINDS.map((k) => [k, 0])) as Record<EngagementKind, number>;
  const isContact = /^[0-9a-f-]{36}$/i.test(key);
  const [c] = isContact
    ? await db.select({ id: contacts.id, name: contacts.name, username: contacts.username, avatarUrl: contacts.avatarUrl, ownerId: contacts.ownerId, ownerName: users.name }).from(contacts).leftJoin(users, eq(users.id, contacts.ownerId)).where(and(eq(contacts.orgId, ctx.orgId), eq(contacts.id, key)))
    : [];
  const [last] = await db.select({ username: engagementEvents.username }).from(engagementEvents).where(and(eq(engagementEvents.orgId, ctx.orgId), eq(engagementEvents.actorKey, key), sql`${engagementEvents.username} is not null`)).limit(1);
  return {
    key,
    position: 0,
    score: 0,
    interactions: 0,
    capped: 0,
    lastAt: "",
    counts: empty,
    contactId: c?.id ?? null,
    name: c?.name ?? null,
    username: c?.username ?? last?.username ?? null,
    avatarUrl: c?.avatarUrl ?? null,
    ownerId: c?.ownerId ?? null,
    ownerName: c?.ownerName ?? null,
    status: "none",
    icp: null,
  };
}

// ---------- Transformar em Lead ----------

export const leadContactSchema = z.object({ key: z.string().min(1).max(200) });

/**
 * Prepara o contato para o fluxo "Transformar em Lead" já existente. Não cria Lead nem cartão:
 * a pessoa só entra no Kanban depois da confirmação no diálogo. Quem só comentou (sem contato)
 * ganha um contato vinculado ao id oficial do Instagram.
 */
export async function prepareLeadContact(ctx: Ctx, input: z.infer<typeof leadContactSchema>) {
  await assertCanView(ctx);
  const isContact = /^[0-9a-f-]{36}$/i.test(input.key);
  let contactId: string | null = isContact ? input.key : input.key.startsWith("contact:") ? input.key.slice(8) : null;
  if (contactId && !/^[0-9a-f-]{36}$/i.test(contactId)) throw notFound("Contato não encontrado.");
  if (!contactId) {
    const [ident] = await db.select({ contactId: channelIdentities.contactId }).from(channelIdentities).where(and(eq(channelIdentities.orgId, ctx.orgId), eq(channelIdentities.externalId, input.key))).limit(1);
    contactId = ident?.contactId ?? null;
  }
  if (!contactId) {
    // Só comentários: cria o contato a partir do autor oficial do comentário mais recente.
    const [ev] = await db
      .select({ accountId: engagementEvents.accountId, username: engagementEvents.username, occurredAt: engagementEvents.occurredAt, commentId: engagementEvents.commentId })
      .from(engagementEvents)
      .where(and(eq(engagementEvents.orgId, ctx.orgId), eq(engagementEvents.actorKey, input.key)))
      .orderBy(sql`${engagementEvents.occurredAt} desc`)
      .limit(1);
    if (!ev) throw notFound("Nenhuma interação identificada para esta pessoa.");
    const externalId = input.key.includes(":") ? null : input.key;
    contactId = await db.transaction(async (tx) => {
      const username = ev.username?.replace(/^@/, "").toLowerCase() ?? null;
      const [ct] = await tx
        .insert(contacts)
        .values({
          orgId: ctx.orgId,
          name: username ? `@${username}` : "Contato do Instagram",
          username,
          profileUrl: username ? `https://www.instagram.com/${username}/` : null,
          source: "instagram_comment",
          ownerId: can(ctx, "contacts.assign") ? null : ctx.userId,
          lastInteractionAt: ev.occurredAt,
        })
        .returning();
      if (externalId && ev.accountId) {
        const ins = await tx.insert(channelIdentities).values({ orgId: ctx.orgId, contactId: ct.id, accountId: ev.accountId, externalId, username }).onConflictDoNothing().returning();
        if (!ins.length) {
          // Outra pessoa criou o contato ao mesmo tempo: usa o dela.
          await tx.delete(contacts).where(eq(contacts.id, ct.id));
          const [again] = await tx.select({ contactId: channelIdentities.contactId }).from(channelIdentities).where(and(eq(channelIdentities.orgId, ctx.orgId), eq(channelIdentities.accountId, ev.accountId), eq(channelIdentities.externalId, externalId)));
          return again.contactId;
        }
        await tx
          .update(socialComments)
          .set({ contactId: ct.id })
          .where(and(eq(socialComments.orgId, ctx.orgId), eq(socialComments.accountId, ev.accountId), eq(socialComments.authorExternalId, externalId), isNull(socialComments.contactId)));
      }
      await audit(tx, ctx, "engagement.contact_created", "contact", ct.id, { username });
      return ct.id;
    });
    await publish({ orgId: ctx.orgId, topic: "contacts", entityId: contactId });
  }
  const [c] = await db.select().from(contacts).where(and(eq(contacts.orgId, ctx.orgId), eq(contacts.id, contactId)));
  if (!c) throw notFound("Contato não encontrado.");
  const target = c.mergedIntoId ? ((await db.select().from(contacts).where(eq(contacts.id, c.mergedIntoId)))[0] ?? c) : c;
  if (!can(ctx, "data.all") && target.ownerId !== ctx.userId) {
    if (!target.ownerId) throw new AppError("forbidden", "Este contato ainda não tem responsável. Um gestor pode distribuí-lo ou transformá-lo em Lead.");
    const [owner] = await db.select({ name: users.name }).from(users).where(eq(users.id, target.ownerId));
    throw new AppError("forbidden", `Este contato está com ${owner?.name ?? "outra pessoa da equipe"}.`);
  }
  const fromComment = !(await db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.contactId, target.id), eq(conversations.channel, "instagram"))).limit(1)).length;
  return { contact: { id: target.id, name: target.name, username: target.username, avatarUrl: target.avatarUrl }, from: fromComment ? ("comment" as const) : ("direct" as const) };
}
