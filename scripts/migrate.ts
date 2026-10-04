import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export async function runMigrations(url: string) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await migrate(drizzle(sql), { migrationsFolder: "drizzle" });
  await sql.end();
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  runMigrations(process.env.DATABASE_URL!)
    .then(() => console.log("Migrações aplicadas."))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
