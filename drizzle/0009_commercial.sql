ALTER TYPE "public"."task_status" ADD VALUE 'in_progress';--> statement-breakpoint
CREATE TABLE "sales_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"type" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"contact_id" uuid,
	"opportunity_id" uuid,
	"appointment_id" uuid,
	"seller_id" uuid,
	"closer_id" uuid,
	"source_id" uuid,
	"campaign" text,
	"product_id" uuid,
	"value_cents" bigint DEFAULT 0 NOT NULL,
	"from_stage_type" text,
	"to_stage_type" text,
	"dedupe_key" text,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"month" text NOT NULL,
	"target_cents" bigint NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"text" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "seller_id" uuid;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "product_id" uuid;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "forwarded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "daily_nudges" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD COLUMN "stage_type" text DEFAULT 'custom' NOT NULL;--> statement-breakpoint
ALTER TABLE "pipelines" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "priority" text DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_events" ADD CONSTRAINT "sales_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_events" ADD CONSTRAINT "sales_events_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_goals" ADD CONSTRAINT "sales_goals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_goals" ADD CONSTRAINT "sales_goals_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_links" ADD CONSTRAINT "task_links_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_links" ADD CONSTRAINT "task_links_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_links" ADD CONSTRAINT "task_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_events_dedupe_uq" ON "sales_events" USING btree ("org_id","dedupe_key") WHERE "sales_events"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "sales_events_org_type_idx" ON "sales_events" USING btree ("org_id","type","occurred_at");--> statement-breakpoint
CREATE INDEX "sales_events_contact_idx" ON "sales_events" USING btree ("contact_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_goals_org_month_uq" ON "sales_goals" USING btree ("org_id","month");--> statement-breakpoint
CREATE INDEX "task_checklist_task_idx" ON "task_checklist_items" USING btree ("task_id","position");--> statement-breakpoint
CREATE INDEX "task_links_task_idx" ON "task_links" USING btree ("task_id","position");--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_uq" ON "notifications" USING btree ("user_id","dedupe_key") WHERE "notifications"."dedupe_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "pipelines_owner_uq" ON "pipelines" USING btree ("org_id","kind","owner_id") WHERE "pipelines"."owner_id" is not null;--> statement-breakpoint
CREATE INDEX "tasks_contact_idx" ON "tasks" USING btree ("contact_id");--> statement-breakpoint
-- ===== Dados existentes: tipos das etapas do funil comercial padrão =====
UPDATE "pipeline_stages" ps SET "stage_type" = CASE ps."key"
  WHEN 'qualificacao' THEN 'entry'
  WHEN 'reuniao-agendada' THEN 'scheduled'
  WHEN 'proposta-enviada' THEN 'negotiation'
  WHEN 'negociacao' THEN 'negotiation'
  ELSE 'custom' END
FROM "pipelines" p WHERE p."id" = ps."pipeline_id" AND p."kind" = 'sales';
--> statement-breakpoint
-- Funil padrão ganha as colunas de venda ganha e perdida (para arrastar e fechar).
INSERT INTO "pipeline_stages" ("org_id", "pipeline_id", "key", "name", "color", "position", "stage_type")
SELECT p."org_id", p."id", x.key, x.name, x.color, (SELECT coalesce(max(position), -1) FROM "pipeline_stages" WHERE pipeline_id = p.id) + x.ord, x.type
FROM "pipelines" p
CROSS JOIN (VALUES ('fechado', 'Fechado', 'green', 1, 'won'), ('perdido', 'Perdido', 'gray', 2, 'lost')) AS x(key, name, color, ord, type)
WHERE p."kind" = 'sales' AND p."owner_id" IS NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- ===== Funil pessoal de cada closer (e de quem já é responsável por oportunidades) =====
INSERT INTO "pipelines" ("org_id", "kind", "name", "owner_id")
SELECT DISTINCT x.org_id, 'sales'::pipeline_kind, 'Comercial', x.user_id FROM (
  SELECT org_id, user_id FROM "memberships" WHERE role = 'closer'
  UNION SELECT org_id, closer_id FROM "opportunities" WHERE closer_id IS NOT NULL
) x
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "pipeline_stages" ("org_id", "pipeline_id", "key", "name", "color", "position", "stage_type")
SELECT p."org_id", p."id", x.key, x.name, x.color, x.ord, x.type
FROM "pipelines" p
CROSS JOIN (VALUES
  ('novo-lead', 'Novo Lead', 'blue', 0, 'entry'),
  ('contato-realizado', 'Contato realizado', 'teal', 1, 'contacted'),
  ('reuniao-agendada', 'Reunião agendada', 'yellow', 2, 'scheduled'),
  ('reuniao-realizada', 'Reunião realizada', 'lilac', 3, 'meeting_done'),
  ('follow-up', 'Follow-up', 'orange', 4, 'follow_up'),
  ('negociacao', 'Negociação', 'pink', 5, 'negotiation'),
  ('fechado', 'Fechado', 'green', 6, 'won'),
  ('perdido', 'Perdido', 'gray', 7, 'lost')
) AS x(key, name, color, ord, type)
WHERE p."kind" = 'sales' AND p."owner_id" IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Oportunidades com closer passam para o funil dele, na etapa de mesmo significado.
UPDATE "opportunities" o SET "stage_id" = target.id, "version" = o."version" + 1
FROM "pipeline_stages" cur, "pipelines" p, "pipeline_stages" target
WHERE cur.id = o.stage_id
  AND p.org_id = o.org_id AND p.kind = 'sales' AND p.owner_id = o.closer_id
  AND target.pipeline_id = p.id
  AND target.stage_type = CASE
    WHEN o.status = 'won' THEN 'won'
    WHEN o.status = 'lost' THEN 'lost'
    WHEN cur.stage_type IN ('scheduled', 'negotiation') THEN cur.stage_type
    ELSE 'entry' END;
--> statement-breakpoint
-- ===== Quem agendou cada reunião =====
UPDATE "appointments" a SET "created_by" = ae.actor_id
FROM (SELECT DISTINCT ON (entity_id) entity_id, actor_id FROM "audit_events" WHERE action = 'appointment.created' ORDER BY entity_id, created_at) ae
WHERE ae.entity_id = a.id AND a.created_by IS NULL;
--> statement-breakpoint
-- ===== Social seller de cada oportunidade e produto =====
UPDATE "opportunities" o SET "seller_id" = o.created_by, "forwarded_at" = o.created_at
FROM "memberships" m WHERE m.org_id = o.org_id AND m.user_id = o.created_by AND m.role = 'seller' AND o.seller_id IS NULL;
--> statement-breakpoint
UPDATE "opportunities" o SET "seller_id" = c.owner_id
FROM "contacts" c, "memberships" m
WHERE c.id = o.contact_id AND m.org_id = o.org_id AND m.user_id = c.owner_id AND m.role = 'seller' AND o.seller_id IS NULL;
--> statement-breakpoint
UPDATE "opportunities" o SET "product_id" = pr.id
FROM "products" pr WHERE pr.org_id = o.org_id AND lower(pr.name) = lower(o.product) AND o.product_id IS NULL;
--> statement-breakpoint
UPDATE "opportunities" o SET "product_id" = l.product_id
FROM "leads" l WHERE l.opportunity_id = o.id AND l.product_id IS NOT NULL AND o.product_id IS NULL;
--> statement-breakpoint
-- ===== Eventos comerciais a partir do histórico real =====
-- Contatos realizados: mensagens enviadas pela equipe (um por contato por dia).
INSERT INTO "sales_events" ("org_id", "type", "occurred_at", "actor_id", "contact_id", "seller_id", "source_id", "dedupe_key")
SELECT DISTINCT ON (cv.org_id, cv.contact_id, (m.sent_at AT TIME ZONE org.timezone)::date)
  cv.org_id, 'contact_made', m.sent_at, m.sent_by, cv.contact_id,
  CASE WHEN mb.role = 'seller' THEN m.sent_by ELSE c.owner_id END, c.first_source_id,
  'contact:' || cv.contact_id || ':' || (m.sent_at AT TIME ZONE org.timezone)::date
FROM "messages" m
JOIN "conversations" cv ON cv.id = m.conversation_id
JOIN "contacts" c ON c.id = cv.contact_id
JOIN "organizations" org ON org.id = cv.org_id
LEFT JOIN "memberships" mb ON mb.org_id = cv.org_id AND mb.user_id = m.sent_by
WHERE m.direction = 'out' AND m.sent_by IS NOT NULL AND m.sent_at IS NOT NULL
ORDER BY cv.org_id, cv.contact_id, (m.sent_at AT TIME ZONE org.timezone)::date, m.sent_at
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "sales_events" ("org_id", "type", "occurred_at", "actor_id", "contact_id", "seller_id", "source_id", "campaign", "product_id", "dedupe_key")
SELECT l.org_id, 'contact_made', l.contacted_at, l.assigned_to, l.contact_id, l.assigned_to, coalesce(c.first_source_id, l.source_id), l.campaign, l.product_id,
  'contact:' || l.contact_id || ':' || (l.contacted_at AT TIME ZONE org.timezone)::date
FROM "leads" l JOIN "contacts" c ON c.id = l.contact_id JOIN "organizations" org ON org.id = l.org_id
WHERE l.contacted_at IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Reuniões agendadas, realizadas, faltas e cancelamentos.
INSERT INTO "sales_events" ("org_id", "type", "occurred_at", "actor_id", "contact_id", "opportunity_id", "appointment_id", "seller_id", "closer_id", "source_id", "campaign", "product_id", "dedupe_key")
SELECT a.org_id, e.type, e.at, a.created_by, a.contact_id, a.opportunity_id, a.id,
  coalesce(o.seller_id, CASE WHEN mb.role = 'seller' THEN a.created_by END, CASE WHEN mo.role = 'seller' THEN c.owner_id END),
  a.owner_id, c.first_source_id,
  (SELECT l.campaign FROM "leads" l WHERE l.contact_id = a.contact_id ORDER BY l.created_at DESC LIMIT 1),
  coalesce(o.product_id, (SELECT l.product_id FROM "leads" l WHERE l.contact_id = a.contact_id ORDER BY l.created_at DESC LIMIT 1)),
  'appt:' || a.id || ':' || e.suffix
FROM "appointments" a
JOIN "contacts" c ON c.id = a.contact_id
LEFT JOIN "opportunities" o ON o.id = a.opportunity_id
LEFT JOIN "memberships" mb ON mb.org_id = a.org_id AND mb.user_id = a.created_by
LEFT JOIN "memberships" mo ON mo.org_id = a.org_id AND mo.user_id = c.owner_id
CROSS JOIN LATERAL (VALUES
  ('meeting_scheduled', a.created_at, 'scheduled', true),
  ('meeting_done', least(a.ends_at, now()), 'done', a.status = 'done'),
  ('meeting_no_show', least(a.ends_at, now()), 'no_show', a.status = 'no_show'),
  ('meeting_canceled', a.updated_at, 'canceled', a.status = 'canceled')
) AS e(type, at, suffix, ok)
WHERE e.ok
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Encaminhamentos, vendas ganhas e perdidas.
INSERT INTO "sales_events" ("org_id", "type", "occurred_at", "actor_id", "contact_id", "opportunity_id", "seller_id", "closer_id", "source_id", "campaign", "product_id", "value_cents", "dedupe_key")
SELECT o.org_id, e.type, e.at, e.actor, o.contact_id, o.id, o.seller_id, o.closer_id, c.first_source_id,
  (SELECT l.campaign FROM "leads" l WHERE l.contact_id = o.contact_id ORDER BY l.created_at DESC LIMIT 1),
  o.product_id, CASE WHEN e.type = 'sale_won' THEN o.value_cents ELSE 0 END,
  'opp:' || o.id || ':' || e.suffix
FROM "opportunities" o
JOIN "contacts" c ON c.id = o.contact_id
CROSS JOIN LATERAL (VALUES
  ('lead_forwarded', o.created_at, o.seller_id, 'forwarded', o.seller_id IS NOT NULL),
  ('sale_won', o.closed_at, o.closer_id, 'won:' || o.version, o.status = 'won' AND o.closed_at IS NOT NULL),
  ('sale_lost', o.closed_at, o.closer_id, 'lost:' || o.version, o.status = 'lost' AND o.closed_at IS NOT NULL)
) AS e(type, at, actor, suffix, ok)
WHERE e.ok
ON CONFLICT DO NOTHING;
