import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type DB = PostgresJsDatabase<typeof schema>;
const g = globalThis as unknown as { __crmlabsSql?: postgres.Sql; __crmlabsDb?: DB };

function connectionString() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não configurada");
  return url;
}

export function getSql(): postgres.Sql {
  if (!g.__crmlabsSql) {
    g.__crmlabsSql = postgres(connectionString(), { max: 10, idle_timeout: 20, onnotice: () => {} });
  }
  return g.__crmlabsSql;
}

export const db: DB = new Proxy({} as DB, {
  get(_t, prop) {
    if (!g.__crmlabsDb) g.__crmlabsDb = drizzle(getSql(), { schema });
    return Reflect.get(g.__crmlabsDb, prop);
  },
});

export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type DbOrTx = DB | Tx;
export { schema };
