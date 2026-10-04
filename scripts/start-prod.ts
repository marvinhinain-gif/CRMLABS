/**
 * Início em produção (Render e similares):
 * 1. aplica as migrações;
 * 2. na primeira vez (banco sem usuários), cria a organização e o primeiro administrador
 *    com o e-mail de BOOTSTRAP_ADMIN_EMAIL e uma senha aleatória mostrada UMA vez no log;
 * 3. inicia o servidor Next.js na porta PORT.
 */
import "dotenv/config";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { sql } from "drizzle-orm";
import { runMigrations } from "./migrate";

async function bootstrap() {
  const { db, getSql } = await import("../src/server/db");
  const { users, memberships } = await import("../src/server/db/schema");
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  if (n > 0 || !email) {
    await getSql().end();
    return;
  }
  const { createOrganization } = await import("../src/server/services/common");
  const { hashPassword } = await import("../src/server/crypto");
  const password = randomBytes(10).toString("base64url");
  const org = await createOrganization({ name: process.env.BOOTSTRAP_ORG_NAME || "AXION" });
  const [u] = await db
    .insert(users)
    .values({ email, name: process.env.BOOTSTRAP_ADMIN_NAME || "Administrador", passwordHash: await hashPassword(password) })
    .returning();
  await db.insert(memberships).values({ orgId: org.id, userId: u.id, role: "admin", status: "active" });
  console.log("\n================ CRMLABS — primeiro acesso ================");
  console.log(`Administrador: ${email}`);
  console.log(`Senha inicial: ${password}`);
  console.log("Troque a senha em Configurações → Perfil depois de entrar.");
  console.log("============================================================\n");
  await getSql().end();
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não configurada");
  await runMigrations(url);
  console.log("Migrações aplicadas.");
  await bootstrap();
  const next = path.join(process.cwd(), "node_modules", ".bin", "next");
  const child = spawn(next, ["start", "-p", process.env.PORT || "3000"], { stdio: "inherit", env: process.env });
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => child.kill(sig));
  child.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
