/**
 * Modo local (um clique): sobe um PostgreSQL embutido, aplica migrações,
 * cria o acesso local + a organização de demonstração na primeira vez,
 * compila (se preciso) e inicia o CRMLABS em http://localhost:3000.
 *
 * Usado por "Iniciar CRMLABS.command" (macOS). Não é o modo de produção.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import net from "node:net";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const ROOT = path.resolve(import.meta.dirname, "..");
const DATA = path.join(ROOT, "dados-locais");
const PG_DIR = path.join(DATA, "postgres");
const STATE = path.join(DATA, "estado.json");
const ACCESS_FILE = path.join(ROOT, "Acesso local.txt");
const PG_PORT = 54329;
const APP_PORT = Number(process.env.PORT ?? 3000);

type State = { pgPassword: string; encryptionKey: string; adminEmail: string; adminPassword: string; demoPassword: string; seeded?: boolean };

function log(msg: string) {
  console.log(`\x1b[32m▸\x1b[0m ${msg}`);
}

function loadState(): State {
  if (existsSync(STATE)) return JSON.parse(readFileSync(STATE, "utf8"));
  mkdirSync(DATA, { recursive: true });
  const s: State = {
    pgPassword: randomBytes(12).toString("hex"),
    encryptionKey: randomBytes(32).toString("base64"),
    adminEmail: process.env.CRMLABS_ADMIN_EMAIL || "admin@crmlabs.local",
    adminPassword: randomBytes(9).toString("base64url"),
    demoPassword: randomBytes(9).toString("base64url"),
  };
  writeFileSync(STATE, JSON.stringify(s, null, 2), { mode: 0o600 });
  return s;
}

/** Impressão digital do código: muda quando qualquer arquivo da aplicação muda (atualizações). */
function sourceHash() {
  const h = createHash("sha256");
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else h.update(full.slice(ROOT.length)).update(readFileSync(full));
    }
  };
  for (const d of ["src", "drizzle"]) if (existsSync(path.join(ROOT, d))) walk(path.join(ROOT, d));
  for (const f of ["package-lock.json", "next.config.ts", "postcss.config.mjs", "tsconfig.json"]) {
    if (existsSync(path.join(ROOT, f))) h.update(f).update(readFileSync(path.join(ROOT, f)));
  }
  return h.digest("hex");
}

function portInUse(port: number) {
  return new Promise<boolean>((resolve) => {
    const s = net.createServer().once("error", () => resolve(true)).once("listening", () => s.close(() => resolve(false))).listen(port, "127.0.0.1");
  });
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv) {
  const r = spawnSync(cmd, args, { cwd: ROOT, env, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`Falhou: ${cmd} ${args.join(" ")}`);
}

async function main() {
  const state = loadState();
  if (await portInUse(APP_PORT)) {
    console.log(`\nA porta ${APP_PORT} já está em uso. Talvez o CRMLABS já esteja aberto: http://localhost:${APP_PORT}\n`);
    process.exit(1);
  }

  const pg = new EmbeddedPostgres({ databaseDir: PG_DIR, user: "crmlabs", password: state.pgPassword, port: PG_PORT, persistent: true, onLog: () => {} });
  if (!existsSync(path.join(PG_DIR, "PG_VERSION"))) {
    log("Criando o banco de dados local (só na primeira vez)…");
    await pg.initialise();
  }
  log("Iniciando o banco de dados…");
  await pg.start();
  try {
    await pg.createDatabase("crmlabs");
  } catch {
    /* já existe */
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    APP_URL: `http://localhost:${APP_PORT}`,
    DATABASE_URL: `postgres://crmlabs:${state.pgPassword}@127.0.0.1:${PG_PORT}/crmlabs`,
    ENCRYPTION_KEY: state.encryptionKey,
    // Sem SMTP no modo local: links de convite/recuperação aparecem nesta janela.
    MAIL_TRANSPORT: "console",
    CRMLABS_LOCAL: "1",
    INSTAGRAM_GRAPH_VERSION: "v25.0",
    NEXT_TELEMETRY_DISABLED: "1",
  };
  const tsx = path.join(ROOT, "node_modules", ".bin", "tsx");
  const next = path.join(ROOT, "node_modules", ".bin", "next");

  log("Atualizando a estrutura do banco…");
  run(tsx, ["scripts/migrate.ts"], env);

  if (!state.seeded) {
    log("Criando seu acesso e a organização de demonstração…");
    run(tsx, ["scripts/seed.ts"], { ...env, SEED_ORG_NAME: "AXION", SEED_ADMIN_NAME: "Marvin Hinain", SEED_ADMIN_EMAIL: state.adminEmail, SEED_ADMIN_PASSWORD: state.adminPassword });
    run(tsx, ["scripts/seed-demo.ts"], { ...env, DEMO_PASSWORD: state.demoPassword, SEED_ADMIN_EMAIL: state.adminEmail });
    state.seeded = true;
    writeFileSync(STATE, JSON.stringify(state, null, 2), { mode: 0o600 });
  }

  writeFileSync(
    ACCESS_FILE,
    [
      "CRMLABS — acesso local (somente neste computador)",
      "",
      `Endereço: http://localhost:${APP_PORT}`,
      `E-mail:   ${state.adminEmail}`,
      `Senha:    ${state.adminPassword}`,
      "",
      "Você entra na organização AXION (vazia, pronta para uso real).",
      "Para ver os dados de demonstração: menu do perfil (canto superior direito) → AXION · Demonstração.",
      "",
      `Usuários da demonstração (senha ${state.demoPassword}):`,
      "  gestora@demo.crmlabs.local · mariana@demo.crmlabs.local · rafael@demo.crmlabs.local · closer@demo.crmlabs.local",
      "",
      "Para encerrar: feche a janela do Terminal ou pressione Ctrl+C nela.",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );

  const buildId = path.join(ROOT, ".next", "BUILD_ID");
  const stampFile = path.join(DATA, "versao-compilada.txt");
  const currentHash = sourceHash();
  const builtHash = existsSync(stampFile) ? readFileSync(stampFile, "utf8").trim() : "";
  if (!existsSync(buildId) || builtHash !== currentHash) {
    log(existsSync(buildId) ? "Aplicando a atualização (cerca de 1 a 2 minutos)…" : "Preparando a aplicação (só na primeira vez, cerca de 1 a 2 minutos)…");
    run(next, ["build"], env);
  }
  writeFileSync(stampFile, currentHash);

  log("Iniciando o CRMLABS…");
  const server: ChildProcess = spawn(next, ["start", "-p", String(APP_PORT)], { cwd: ROOT, env, stdio: ["ignore", "pipe", "inherit"] });
  let opened = false;
  server.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    if (!/telemetry|nextjs\.org/i.test(text)) process.stdout.write(text);
    if (!opened && /Ready|started server|Local:/i.test(text)) {
      opened = true;
      console.log(`\n\x1b[1mCRMLABS aberto em http://localhost:${APP_PORT}\x1b[0m`);
      console.log(`Login: ${state.adminEmail}  ·  Senha: ${state.adminPassword}  (também em "Acesso local.txt")`);
      console.log("Mantenha esta janela aberta enquanto usa o CRMLABS.\n");
      if (process.platform === "darwin" && !process.env.CRMLABS_NO_OPEN) spawn("open", [`http://localhost:${APP_PORT}`], { stdio: "ignore", detached: true }).unref();
    }
  });

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    console.log("\nEncerrando o CRMLABS…");
    server.kill("SIGTERM");
    await pg.stop().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGHUP", shutdown);
  server.on("exit", (code) => {
    if (!stopping) {
      console.error(`O servidor parou (código ${code}).`);
      shutdown();
    }
  });
}

main().catch(async (e) => {
  console.error(`\n\x1b[31mNão foi possível iniciar o CRMLABS:\x1b[0m ${(e as Error).message}`);
  process.exit(1);
});
