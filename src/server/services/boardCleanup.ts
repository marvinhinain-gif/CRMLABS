import { sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "../db";
import type { Ctx } from "../context";
import { AppError } from "../errors";
import { publish } from "../realtime";

export const boardCleanupSchema = z.object({ expectedTotal: z.number().int().min(0) });

const ITEMS_LIMIT = 200;
export const CLEANUP_REASON = "Limpeza do quadro: sem responsável ou sem conversa";

/**
 * Cartões ativos que devem sair do quadro: sem responsável OU sem nenhuma interação real
 * (mensagem enviada, nota, movimentação humana, resposta a comentário, cadência, reunião, oportunidade, tarefa).
 * Contatos arquivados/mesclados ficam de fora, como no quadro. Um único SELECT com EXISTS em colunas indexadas.
 */
function candidatesSql(orgId: string) {
  return sql`
    select re.id as entry_id, re.contact_id, re.stage_id, re.version,
      c.name, c.username, c.avatar_url, c.owner_id,
      ps.name as stage_name, ps.color as stage_color, ps.position as stage_position,
      u.name as owner_name,
      case when c.owner_id is null then 'sem_responsavel' else 'sem_interacao' end as reason
    from relationship_entries re
    join contacts c on c.id = re.contact_id
    join pipeline_stages ps on ps.id = re.stage_id
    left join users u on u.id = c.owner_id
    where re.org_id = ${orgId} and re.closed_at is null
      and c.archived_at is null and c.merged_into_id is null
      and (
        c.owner_id is null
        or not (
          exists (select 1 from conversations cv join messages m on m.conversation_id = cv.id
                  where cv.org_id = re.org_id and cv.contact_id = c.id and m.direction = 'out')
          or exists (select 1 from notes n where n.contact_id = c.id)
          or exists (select 1 from stage_history sh where sh.contact_id = c.id and sh.entity_id = re.id
                     and sh.entity_type = 'relationship' and sh.from_stage_id is not null and sh.actor_id is not null)
          or exists (select 1 from social_comments sc join comment_replies cr on cr.comment_id = sc.id
                     where sc.contact_id = c.id)
          or exists (select 1 from cadence_activities ca where ca.contact_id = c.id)
          or exists (select 1 from appointments a where a.contact_id = c.id)
          or exists (select 1 from opportunities o where o.contact_id = c.id)
          or exists (select 1 from tasks t where t.contact_id = c.id)
        )
      )`;
}

type Row = {
  entry_id: string;
  contact_id: string;
  stage_id: string;
  name: string;
  username: string | null;
  avatar_url: string | null;
  stage_name: string;
  stage_color: string;
  stage_position: number;
  owner_name: string | null;
  reason: "sem_responsavel" | "sem_interacao";
};

async function loadCandidates(ctx: Ctx, tx: DbOrTx = db) {
  const rows = await tx.execute<Row>(sql`select * from (${candidatesSql(ctx.orgId)}) x order by stage_position asc, lower(name) asc`);
  return Array.from(rows);
}

export async function getBoardCleanupPreview(ctx: Ctx) {
  const rows = await loadCandidates(ctx);
  const byStage = new Map<string, { stageId: string; stageName: string; color: string; count: number }>();
  for (const r of rows) {
    const s = byStage.get(r.stage_id) ?? { stageId: r.stage_id, stageName: r.stage_name, color: r.stage_color, count: 0 };
    s.count++;
    byStage.set(r.stage_id, s);
  }
  return {
    total: rows.length,
    byStage: [...byStage.values()],
    items: rows.slice(0, ITEMS_LIMIT).map((r) => ({
      entryId: r.entry_id,
      contactId: r.contact_id,
      name: r.name,
      username: r.username,
      avatarUrl: r.avatar_url,
      stageName: r.stage_name,
      ownerName: r.owner_name,
      reason: r.reason,
    })),
  };
}

/** Tira do quadro (fecha a entrada) todos os candidatos, numa transação, com histórico. Contato e lead não são tocados. */
export async function runBoardCleanup(ctx: Ctx, input: z.infer<typeof boardCleanupSchema>) {
  const removed = await db.transaction(async (tx) => {
    const [cur] = Array.from(await tx.execute<{ n: number }>(sql`select count(*)::int as n from (${candidatesSql(ctx.orgId)}) x`));
    if ((cur?.n ?? 0) !== input.expectedTotal) throw new AppError("conflict", "O quadro mudou, revise de novo.");
    if (!input.expectedTotal) return 0;
    const res = await tx.execute<{ n: number }>(sql`
      with cand as (${candidatesSql(ctx.orgId)}),
      upd as (
        update relationship_entries re
        set closed_at = now(), version = re.version + 1, updated_at = now()
        from cand
        where re.id = cand.entry_id and re.closed_at is null
        returning re.id, re.contact_id, re.stage_id
      ),
      ins as (
        insert into stage_history (org_id, entity_type, entity_id, contact_id, from_stage_id, to_stage_id, from_stage_name, actor_id, reason)
        select ${ctx.orgId}, 'relationship', upd.id, upd.contact_id, upd.stage_id, null, ps.name, ${ctx.userId}, ${CLEANUP_REASON}
        from upd join pipeline_stages ps on ps.id = upd.stage_id
        returning 1
      )
      select count(*)::int as n from upd`);
    const n = Array.from(res)[0]?.n ?? 0;
    if (n !== input.expectedTotal) throw new AppError("conflict", "O quadro mudou, revise de novo.");
    return n;
  });
  if (removed) await publish({ orgId: ctx.orgId, topic: "board" });
  return { removed };
}
