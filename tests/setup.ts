import "dotenv/config";
import { beforeAll, beforeEach } from "vitest";

if (!process.env.TEST_DATABASE_URL) throw new Error("Defina TEST_DATABASE_URL para rodar os testes");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.MAIL_TRANSPORT = "console";
process.env.INSTAGRAM_APP_ID = "test-app-id";
process.env.INSTAGRAM_APP_SECRET = "test-app-secret";
process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN = "test-verify-token";
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

let migrated = false;

beforeAll(async () => {
  if (migrated) return;
  const { runMigrations } = await import("../scripts/migrate");
  await runMigrations(process.env.TEST_DATABASE_URL!);
  migrated = true;
});

beforeEach(async () => {
  const { getSql } = await import("@/server/db");
  const sql = getSql();
  const tables = await sql<{ tablename: string }[]>`select tablename from pg_tables where schemaname = 'public' and tablename not like '__drizzle%'`;
  await sql.unsafe(`truncate ${tables.map((t) => `"${t.tablename}"`).join(", ")} restart identity cascade`);
  const { setInstagramApiForTests } = await import("@/server/integrations/instagram/client");
  setInstagramApiForTests(null);
});
