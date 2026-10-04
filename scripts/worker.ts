/**
 * Worker dedicado: consome a fila de webhooks, renova tokens e aplica retenção.
 * Use em produção com processo separado (`npm run worker`) ou, no plano grátis do Render,
 * defina RUN_WORKER=true no serviço web (ver src/instrumentation.ts).
 */
import "dotenv/config";
import { startBackgroundLoop } from "../src/server/background";

startBackgroundLoop();
process.stdin.resume();
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(0));
