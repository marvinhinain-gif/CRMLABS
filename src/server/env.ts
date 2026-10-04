export const isProduction = () => process.env.NODE_ENV === "production";

export function appUrl() {
  // No Render, RENDER_EXTERNAL_URL traz o endereço público (https://….onrender.com).
  return (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:3000").replace(/\/$/, "");
}

/** Configuração do Instagram. Retorna lista do que falta para ativar a integração. */
export function instagramConfig() {
  const cfg = {
    appId: process.env.INSTAGRAM_APP_ID ?? "",
    appSecret: process.env.INSTAGRAM_APP_SECRET ?? "",
    verifyToken: process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN ?? "",
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
