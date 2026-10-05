export const isProduction = () => process.env.NODE_ENV === "production";

export function appUrl() {
  // No Render, RENDER_EXTERNAL_URL traz o endereço público (https://….onrender.com).
  return (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:3000").replace(/\/$/, "");
}

/**
 * Configurações salvas pelo painel (tabela instance_settings), já descriptografadas.
 * Preenchido por loadInstanceSettings() (services/instance.ts); variáveis de ambiente têm prioridade.
 */
export const instanceCache: { values: Map<string, string>; loadedAt: number } = (globalThis as unknown as { __crmlabsInstance?: { values: Map<string, string>; loadedAt: number } }).__crmlabsInstance ??= {
  values: new Map(),
  loadedAt: 0,
};

/** Origem de cada credencial do Instagram: variável de ambiente, painel ou ausente. */
export function instagramSource(envKey: string, settingKey: string): "env" | "panel" | "missing" {
  if (process.env[envKey]) return "env";
  if (instanceCache.values.get(settingKey)) return "panel";
  return "missing";
}

/** Configuração do Instagram. Retorna lista do que falta para ativar a integração. */
export function instagramConfig() {
  const v = instanceCache.values;
  const cfg = {
    appId: process.env.INSTAGRAM_APP_ID || v.get("instagram.app_id") || "",
    appSecret: process.env.INSTAGRAM_APP_SECRET || v.get("instagram.app_secret") || "",
    verifyToken: process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || v.get("instagram.verify_token") || "",
    graphVersion: process.env.INSTAGRAM_GRAPH_VERSION || "v25.0",
    humanAgentEnabled: process.env.INSTAGRAM_HUMAN_AGENT_ENABLED === "true",
    redirectUri: `${appUrl()}/api/integrations/instagram/callback`,
    webhookUrl: `${appUrl()}/api/webhooks/instagram`,
  };
  const missing: string[] = [];
  if (!cfg.appId) missing.push("INSTAGRAM_APP_ID");
  if (!cfg.appSecret) missing.push("INSTAGRAM_APP_SECRET");
  if (!cfg.verifyToken) missing.push("INSTAGRAM_WEBHOOK_VERIFY_TOKEN");
  if (!process.env.ENCRYPTION_KEY) missing.push("ENCRYPTION_KEY");
  const httpsPublic = appUrl().startsWith("https://") && !/localhost|127\.0\.0\.1/.test(appUrl());
  return { ...cfg, missing, httpsPublic };
}

/** Cookies "Secure" só quando a aplicação é servida por HTTPS (Safari recusa Secure em http://localhost). */
export const secureCookies = () => appUrl().startsWith("https://");
