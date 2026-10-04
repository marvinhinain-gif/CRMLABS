/**
 * Cria a organização inicial e o primeiro administrador (idempotente).
 * Uso: SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... npm run db:seed
 */
import "dotenv/config";
import { and, eq, sql } from "drizzle-orm";
import { db, getSql } from "../src/server/db";
import { memberships, organizations, users } from "../src/server/db/schema";
import { createOrganization } from "../src/server/services/common";
import { hashPassword } from "../src/server/crypto";
import { validatePassword } from "../src/server/auth/service";

async function main() {
  const orgName = process.env.SEED_ORG_NAME || "AXION";
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const name = process.env.SEED_ADMIN_NAME?.trim() || "Administrador";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "";
  if (!email || !password) throw new Error("Defina SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD no .env");
  validatePassword(password);

  let [org] = await db.select().from(organizations).where(and(eq(organizations.name, orgName), eq(organizations.isDemo, false)));
  if (!org) org = await createOrganization({ name: orgName });

  let [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`);
  if (!user) [user] = await db.insert(users).values({ email, name, passwordHash: await hashPassword(password) }).returning();

  await db
    .insert(memberships)
    .values({ orgId: org.id, userId: user.id, role: "admin", status: "active" })
    .onConflictDoUpdate({ target: [memberships.orgId, memberships.userId], set: { role: "admin", status: "active" } });

  console.log(`Organização "${org.name}" pronta. Administrador: ${email}`);
}

main()
  .then(() => getSql().end())
  .catch(async (e) => {
    console.error(e.message ?? e);
    await getSql().end();
    process.exit(1);
  });
