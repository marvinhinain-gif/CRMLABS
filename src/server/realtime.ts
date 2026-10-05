import { EventEmitter } from "node:events";
import { getSql } from "./db";
import type { Ctx } from "./context";
import { can } from "./permissions";
import { logger } from "./logger";

export type Topic = "board" | "contacts" | "conversations" | "comments" | "tasks" | "opportunities" | "notifications" | "settings" | "leads";

/**
 * Evento de invalidação. Não carrega dados de negócio: o cliente recarrega pela API,
 * que reaplica as permissões. Mesmo assim, o evento só é entregue a quem pode ver o registro.
 */
export type RealtimeEvent = {
  orgId: string;
  topic: Topic;
  entityId?: string;
  /** Usuários diretamente relacionados (responsável do contato, da conversa, closer…). */
  ownerIds?: (string | null | undefined)[];
  /** Evento destinado a um único usuário (ex.: notificação). */
  userId?: string;
  /** Visível a sellers quando a caixa compartilhada está ativa (conversa sem responsável). */
  sharedInbox?: boolean;
  /** Visível somente para admin/gestor. */
  managersOnly?: boolean;
};

const CHANNEL = "crmlabs_events";
const g = globalThis as unknown as { __crmlabsBus?: EventEmitter; __crmlabsListening?: Promise<unknown> };

function bus() {
  if (!g.__crmlabsBus) {
    g.__crmlabsBus = new EventEmitter();
    g.__crmlabsBus.setMaxListeners(0);
  }
  return g.__crmlabsBus;
}

async function ensureListening() {
  g.__crmlabsListening ??= getSql()
    .listen(CHANNEL, (payload) => {
      try {
        bus().emit("event", JSON.parse(payload) as RealtimeEvent);
      } catch (e) {
        logger.warn("Evento de tempo real inválido", e);
      }
    })
    .catch((e) => {
      g.__crmlabsListening = undefined;
      logger.error("Falha ao escutar eventos do Postgres", e);
    });
  return g.__crmlabsListening;
}

/** Publica via Postgres NOTIFY (funciona com várias instâncias do servidor). */
export async function publish(event: RealtimeEvent) {
  if (process.env.VITEST === "true") {
    bus().emit("event", event);
    return;
  }
  try {
    await getSql().notify(CHANNEL, JSON.stringify(event));
  } catch (e) {
    logger.warn("Falha ao publicar evento de tempo real", e);
  }
}

export function canReceive(ctx: Ctx, e: RealtimeEvent) {
  if (e.orgId !== ctx.orgId) return false;
  if (e.userId) return e.userId === ctx.userId;
  if (can(ctx, "data.all")) return true;
  if (e.managersOnly) return false;
  if (e.ownerIds?.includes(ctx.userId)) return true;
  if (e.sharedInbox && ctx.org.sharedInbox && ctx.role === "seller") return true;
  // Comentários são públicos e a caixa de comentários é do social seller (o evento não leva dados, só "atualize").
  if (e.topic === "comments" && ctx.role === "seller") return true;
  return false;
}

export async function subscribe(ctx: Ctx, onEvent: (e: RealtimeEvent) => void) {
  await ensureListening();
  const listener = (e: RealtimeEvent) => {
    if (canReceive(ctx, e)) onEvent(e);
  };
  bus().on("event", listener);
  return () => bus().off("event", listener);
}

/** Escuta todos os eventos no próprio servidor (ex.: entregar notificações no celular). */
export async function onServerEvent(fn: (e: RealtimeEvent) => void) {
  await ensureListening();
  bus().on("event", fn);
}
