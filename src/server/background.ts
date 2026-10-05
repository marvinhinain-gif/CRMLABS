import { processPendingEvents } from "./integrations/instagram/webhooks";
import { refreshExpiringTokens } from "./integrations/instagram/oauth";
import { applyRetention } from "./integrations/instagram/retention";
import { logger } from "./logger";
import { onServerEvent } from "./realtime";
import { dispatchPendingPush } from "./services/push";

const HOUR = 3600_000;
const g = globalThis as unknown as { __crmlabsLoop?: boolean };

/** Fila de webhooks e notificações no celular (a cada 10 s), renovação de tokens (de hora em hora) e retenção (diária). */
export function startBackgroundLoop() {
  if (g.__crmlabsLoop) return;
  g.__crmlabsLoop = true;
  let lastHourly = 0;
  let lastDaily = 0;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await processPendingEvents(100);
      await dispatchPendingPush(100);
      if (Date.now() - lastHourly > HOUR) {
        lastHourly = Date.now();
        await refreshExpiringTokens();
      }
      if (Date.now() - lastDaily > 24 * HOUR) {
        lastDaily = Date.now();
        await applyRetention();
      }
    } catch (e) {
      logger.error("Falha no processamento em segundo plano", e);
    } finally {
      running = false;
    }
  };
  setInterval(tick, 10_000).unref();

  // Notificação nova → entrega no celular em segundos (a varredura acima cobre o que escapar).
  let pushTimer: NodeJS.Timeout | null = null;
  const pushSoon = () => {
    if (pushTimer) return;
    pushTimer = setTimeout(() => {
      pushTimer = null;
      dispatchPendingPush(50)
        .then((n) => n === 50 && pushSoon())
        .catch((e) => logger.warn("Falha ao entregar notificações no celular", e));
    }, 700);
  };
  void onServerEvent((e) => {
    if (e.topic === "notifications") pushSoon();
  }).catch((e) => logger.warn("Sem escuta de eventos para notificações no celular", e));
  logger.info("Processamento em segundo plano ativo no servidor web");
}
