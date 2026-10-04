/** Logger que remove segredos e conteúdo de mensagens antes de registrar. */
const SENSITIVE = /(access_token|token|secret|password|authorization|cookie)=([^&\s"]+)/gi;

function scrub(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message.replace(SENSITIVE, "$1=[redacted]"), stack: value.stack?.split("\n").slice(0, 6).join("\n") };
  }
  if (typeof value === "string") return value.replace(SENSITIVE, "$1=[redacted]");
  return value;
}

export const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => {
    if (process.env.VITEST !== "true") console.info(`[crmlabs] ${msg}`, meta ?? "");
  },
  warn: (msg: string, meta?: unknown) => console.warn(`[crmlabs] ${msg}`, scrub(meta) ?? ""),
  error: (msg: string, err?: unknown) => {
    if (process.env.VITEST === "true" && process.env.SHOW_ERRORS !== "1") return;
    console.error(`[crmlabs] ${msg}`, scrub(err));
  },
};
