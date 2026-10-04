import { processPendingEvents } from "./integrations/instagram/webhooks";
import { refreshExpiringTokens } from "./integrations/instagram/oauth";
import { applyRetention } from "./integrations/instagram/retention";
import { logger } from "./logger";

const HOUR = 3600_000;
const g = globalThis as unknown as { __crmlabsLoop?: boolean };

/** Fila de webhooks (a cada 10 s), renovação de tokens (de hora em hora) e retenção (diária). */
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
  logger.info("Processamento em segundo plano ativo no servidor web");
}
