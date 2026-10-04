/**
 * Cria uma organização de DEMONSTRAÇÃO separada (is_demo = true), com dados fictícios.
 * - Os dados ficam em outra organização: nunca se misturam com a operação real.
 * - Envio externo é bloqueado em organizações demo.
 * - Nenhuma conta do Instagram é simulada como "conectada".
 * Uso: npm run db:seed:demo   (DEMO_PASSWORD opcional; se ausente, uma senha é gerada e exibida)
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, getSql } from "../src/server/db";
import {
  appointments,
  contacts,
  conversations,
  memberships,
  messages,
  notes,
  opportunities,
  organizations,
  pipelineStages,
  relationshipEntries,
  savedReplies,
  stageHistory,
  tasks,
  users,
} from "../src/server/db/schema";
import { createOrganization, getPipeline } from "../src/server/services/common";
import { hashPassword } from "../src/server/crypto";

const DEMO_ORG = "AXION · Demonstração";
const H = 3600_000;

function at(dayOffset: number, hour: number, minute = 0) {
  // Horário em America/Bahia (UTC−3, sem horário de verão)
  const now = new Date();
  const local = new Date(now.getTime() - 3 * H);
  const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + dayOffset, hour + 3, minute));
  return d;
}

async function main() {
  const existing = await db.select().from(organizations).where(and(eq(organizations.name, DEMO_ORG), eq(organizations.isDemo, true)));
  for (const o of existing) await db.delete(organizations).where(eq(organizations.id, o.id)); // recria do zero

  const org = await createOrganization({ name: DEMO_ORG, isDemo: true });
  const password = process.env.DEMO_PASSWORD || randomBytes(9).toString("base64url");
  const hash = await hashPassword(password);

  const people = [
    { key: "admin", name: "Marvin Hinain", email: "admin@demo.crmlabs.local", role: "admin" as const },
    { key: "manager", name: "Gabriela Nunes", email: "gestora@demo.crmlabs.local", role: "manager" as const },
    { key: "mariana", name: "Mariana Alves", email: "mariana@demo.crmlabs.local", role: "seller" as const },
    { key: "rafael", name: "Rafael Costa", email: "rafael@demo.crmlabs.local", role: "seller" as const },
    { key: "carla", name: "Carla Menezes", email: "closer@demo.crmlabs.local", role: "closer" as const },
  ];
  const u: Record<string, string> = {};
  for (const p of people) {
    let [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${p.email}`);
    if (!user) [user] = await db.insert(users).values({ email: p.email, name: p.name, passwordHash: hash }).returning();
    else await db.update(users).set({ passwordHash: hash, name: p.name }).where(eq(users.id, user.id));
    await db.insert(memberships).values({ orgId: org.id, userId: user.id, role: p.role, status: "active" });
    u[p.key] = user.id;
  }
  // Se o administrador real já existe, ele também acessa a demo pelo seletor de organização.
  const realAdmin = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  if (realAdmin) {
    const [ra] = await db.select().from(users).where(sql`lower(${users.email}) = ${realAdmin}`);
    if (ra) await db.insert(memberships).values({ orgId: org.id, userId: ra.id, role: "admin", status: "active" }).onConflictDoNothing();
  }

  const rel = await getPipeline(org.id, "relationship");
  const sales = await getPipeline(org.id, "sales");
  const relStages = await db.select().from(pipelineStages).where(eq(pipelineStages.pipelineId, rel.id)).orderBy(pipelineStages.position);
  const salesStages = await db.select().from(pipelineStages).where(eq(pipelineStages.pipelineId, sales.id)).orderBy(pipelineStages.position);
  const S = Object.fromEntries(relStages.map((s) => [s.key, s]));

  const cards: { name: string; user: string; stage: string; summary: string; owner: string; next: [number, number, number?]; unread?: number; msg?: string; ago?: number }[] = [
    { name: "Ana Souza", user: "anasouza", stage: "engajado-1", summary: "Interagiu no conteúdo.", owner: "mariana", next: [0, 10], unread: 2, msg: "Quero entender a consultoria.", ago: 2 },
    { name: "Bruno Costa", user: "brunocosta", stage: "engajado-1", summary: "Primeiro contato.", owner: "rafael", next: [1, 9], unread: 1, msg: "Oi! Vi seu reels sobre vendas.", ago: 6 },
    { name: "Julia Alves", user: "juliaalves", stage: "engajado-1", summary: "Comentou no post.", owner: "mariana", next: [1, 10, 30] },
    { name: "Pedro Lima", user: "pedrolima", stage: "seguidor-engajado-2", summary: "Segunda interação.", owner: "rafael", next: [0, 11, 30], unread: 3, msg: "Podemos conversar amanhã?", ago: 3 },
    { name: "Luiza Rocha", user: "luizarocha", stage: "seguidor-engajado-2", summary: "Conversa iniciada.", owner: "mariana", next: [1, 9] },
    { name: "Camila Santos", user: "camilasantos", stage: "em-relacionamento", summary: "Entender o momento.", owner: "mariana", next: [0, 14], unread: 1, msg: "Obrigada pelo retorno!", ago: 5 },
    { name: "Rafael Melo", user: "rafaelmelo", stage: "em-relacionamento", summary: "Retomar conversa.", owner: "rafael", next: [0, 15] },
    { name: "Lucas Oliveira", user: "lucasoliveira", stage: "novo-interessado", summary: "Interesse na consultoria.", owner: "mariana", next: [0, 16], unread: 2, msg: "Qual o investimento da mentoria?", ago: 1 },
    { name: "Beatriz Dias", user: "beatrizdias", stage: "novo-interessado", summary: "Pediu informações.", owner: "rafael", next: [1, 9, 30] },
    { name: "Fernanda Reis", user: "fernandareis", stage: "em-qualificacao", summary: "Avaliar perfil e objetivo.", owner: "mariana", next: [0, 17] },
    { name: "Thiago Prado", user: "thiagoprado", stage: "encaminhado-closer", summary: "Diagnóstico agendado.", owner: "rafael", next: [2, 10] },
  ];

  const ids: Record<string, string> = {};
  for (const [i, c] of cards.entries()) {
    const created = new Date(Date.now() - (14 - i) * 24 * H);
    const [row] = await db
      .insert(contacts)
      .values({
        orgId: org.id,
        name: c.name,
        username: c.user,
        profileUrl: `https://www.instagram.com/${c.user}/`,
        source: "manual",
        ownerId: u[c.owner],
        summary: c.summary,
        nextAction: c.summary.includes("Retomar") ? "Retomar conversa" : "Responder e qualificar",
        nextActionAt: at(c.next[0], c.next[1], c.next[2] ?? 0),
        lastInteractionAt: new Date(Date.now() - (c.ago ?? 24) * H),
        createdAt: created,
      })
      .returning();
    ids[c.user] = row.id;
    const [entry] = await db.insert(relationshipEntries).values({ orgId: org.id, pipelineId: rel.id, contactId: row.id, stageId: S[c.stage].id, position: i }).returning();
    // Histórico coerente: entrada em Engajado #1 e avanço até a etapa atual.
    const path = relStages.slice(0, relStages.findIndex((s) => s.key === c.stage) + 1);
    for (const [k, st] of path.entries()) {
      await db.insert(stageHistory).values({
        orgId: org.id,
        entityType: "relationship",
        entityId: entry.id,
        contactId: row.id,
        fromStageId: k ? path[k - 1].id : null,
        fromStageName: k ? path[k - 1].name : null,
        toStageId: st.id,
        toStageName: st.name,
        actorId: u[c.owner],
        reason: k ? null : "Entrada no funil",
        createdAt: new Date(created.getTime() + k * 20 * H),
      });
    }
    if (c.msg) {
      const [conv] = await db
        .insert(conversations)
        .values({ orgId: org.id, contactId: row.id, channel: "instagram", ownerId: u[c.owner], lastMessageAt: new Date(Date.now() - (c.ago ?? 1) * H), lastMessageDirection: "in", lastMessagePreview: c.msg, lastInboundAt: new Date(Date.now() - (c.ago ?? 1) * H), unreadCount: c.unread ?? 0 })
        .returning();
      await db.insert(messages).values([
        { orgId: org.id, conversationId: conv.id, direction: "in", body: "Oi! Tudo bem? Acompanho seu conteúdo há um tempo.", status: "received", sentAt: new Date(Date.now() - ((c.ago ?? 1) + 20) * H) },
        { orgId: org.id, conversationId: conv.id, direction: "out", body: `Oi, ${c.name.split(" ")[0]}! Tudo ótimo, e com você? Que bom ter você por aqui.`, status: "accepted", sentBy: u[c.owner], sentAt: new Date(Date.now() - ((c.ago ?? 1) + 19) * H) },
        { orgId: org.id, conversationId: conv.id, direction: "in", body: c.msg, status: "received", sentAt: new Date(Date.now() - (c.ago ?? 1) * H) },
      ]);
    }
  }

  // Comercial: oportunidades (uma ganha neste mês), reuniões e tarefas.
  const [o1] = await db
    .insert(opportunities)
    .values({ orgId: org.id, contactId: ids.thiagoprado, title: "Mentoria comercial — 6 meses", product: "Mentoria", valueCents: 4_000_000, closerId: u.carla, stageId: salesStages[3].id, status: "won", closedAt: new Date(Date.now() - 2 * 24 * H), createdBy: u.rafael })
    .returning();
  await db.insert(opportunities).values([
    { orgId: org.id, contactId: ids.fernandareis, title: "Consultoria de posicionamento", product: "Consultoria", valueCents: 1_250_000, closerId: u.carla, stageId: salesStages[1].id, createdBy: u.mariana, expectedCloseDate: at(10, 12).toISOString().slice(0, 10) },
    { orgId: org.id, contactId: ids.lucasoliveira, title: "Mentoria em grupo", product: "Mentoria", valueCents: 480_000, closerId: u.carla, stageId: salesStages[0].id, createdBy: u.mariana },
  ]);
  for (const st of [salesStages[0], salesStages[3]]) {
    await db.insert(stageHistory).values({ orgId: org.id, entityType: "opportunity", entityId: o1.id, contactId: ids.thiagoprado, toStageId: st.id, toStageName: st.name, actorId: u.carla });
  }
  await db.insert(appointments).values([
    { orgId: org.id, contactId: ids.fernandareis, ownerId: u.carla, title: "Reunião de diagnóstico", startsAt: at(1, 15), endsAt: at(1, 16), location: "Google Meet (link enviado no Direct)" },
    { orgId: org.id, contactId: ids.thiagoprado, opportunityId: o1.id, ownerId: u.carla, title: "Onboarding da mentoria", startsAt: at(3, 10), endsAt: at(3, 11), location: "Escritório AXION" },
  ]);
  await db.insert(tasks).values([
    { orgId: org.id, title: "Retomar conversa com Ana", notes: "Responder sobre a consultoria e enviar materiais.", contactId: ids.anasouza, ownerId: u.mariana, dueAt: at(0, 10), createdBy: u.mariana },
    { orgId: org.id, title: "Confirmar reunião com Pedro", notes: "Alinhar horário e enviar o link da reunião.", contactId: ids.pedrolima, ownerId: u.rafael, dueAt: at(0, 11, 30), createdBy: u.rafael },
    { orgId: org.id, title: "Enviar proposta para Camila", notes: "Preparar proposta comercial.", contactId: ids.camilasantos, ownerId: u.mariana, dueAt: at(0, 14), createdBy: u.mariana },
    { orgId: org.id, title: "Follow-up Beatriz", notes: "Ela pediu informações na semana passada.", contactId: ids.beatrizdias, ownerId: u.rafael, dueAt: at(-1, 16), createdBy: u.rafael },
  ]);
  await db.insert(notes).values({ orgId: org.id, contactId: ids.anasouza, authorId: u.mariana, body: "Prefere conversar no fim da tarde. Tem equipe de 3 vendedores." });
  await db.insert(savedReplies).values([
    { orgId: org.id, title: "Boas-vindas", body: "Oi! Que bom falar com você por aqui. Como posso te ajudar?" },
    { orgId: org.id, title: "Agendar conversa", body: "Que tal marcarmos uma conversa rápida de 20 minutos para entender seu momento? Qual horário fica melhor?" },
  ]);

  console.log("\nOrganização de demonstração criada (dados fictícios, envio externo desativado).");
  console.log(`Senha de todos os usuários demo: ${password}`);
  for (const p of people) console.log(`  ${p.role.padEnd(8)} ${p.email}`);
}

main()
  .then(() => getSql().end())
  .catch(async (e) => {
    console.error(e);
    await getSql().end();
    process.exit(1);
  });
