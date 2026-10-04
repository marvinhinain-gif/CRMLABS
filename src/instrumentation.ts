/**
 * Roda o processamento em segundo plano dentro do próprio servidor web quando RUN_WORKER=true
 * (ex.: plano grátis do Render, que não oferece processo de worker separado).
 * Em produção com worker dedicado (`npm run worker`), deixe RUN_WORKER desligado.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.RUN_WORKER !== "true") return;
  const { startBackgroundLoop } = await import("./server/background");
  startBackgroundLoop();
}
