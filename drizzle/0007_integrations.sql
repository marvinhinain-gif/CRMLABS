CREATE TABLE "contact_touchpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"source_id" uuid,
	"kind" text DEFAULT 'form' NOT NULL,
	"campaign" text,
	"channel" text,
	"partner" text,
	"ad_name" text,
	"integration_id" uuid,
	"integration_name" text,
	"lead_id" uuid,
	"utm" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"note" text,
	"actor_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"show_to_closer" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"integration_id" uuid,
	"integration_name" text,
	"event" text NOT NULL,
	"result" text NOT NULL,
	"message" text,
	"lead_id" uuid,
	"detected" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'gray' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "first_source_id" uuid;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "first_touch_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "last_source_id" uuid;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "last_touch_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lead_forms" ADD COLUMN "provider" text DEFAULT 'crmlabs_form' NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_forms" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "lead_forms" ADD COLUMN "campaign" text;--> statement-breakpoint
ALTER TABLE "lead_forms" ADD COLUMN "channel" text;--> statement-breakpoint
ALTER TABLE "lead_forms" ADD COLUMN "partner" text;--> statement-breakpoint
ALTER TABLE "lead_forms" ADD COLUMN "ad_name" text;--> statement-breakpoint
ALTER TABLE "lead_forms" ADD COLUMN "product_id" uuid;--> statement-breakpoint
ALTER TABLE "lead_forms" ADD COLUMN "pipeline_kind" text DEFAULT 'relationship' NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_forms" ADD COLUMN "sales_stage_id" uuid;--> statement-breakpoint
ALTER TABLE "lead_forms" ADD COLUMN "assign_mode" text DEFAULT 'round_robin' NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_forms" ADD COLUMN "fixed_assignee_id" uuid;--> statement-breakpoint
ALTER TABLE "lead_forms" ADD COLUMN "assign_rules" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_forms" ADD COLUMN "field_map" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_forms" ADD COLUMN "signing_secret_enc" text;--> statement-breakpoint
ALTER TABLE "lead_forms" ADD COLUMN "last_sample" jsonb;--> statement-breakpoint
ALTER TABLE "lead_forms" ADD COLUMN "last_lead_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lead_forms" ADD COLUMN "last_error_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lead_forms" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "campaign" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "ad_channel" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "partner" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "ad_name" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "product_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "custom" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "opportunity_id" uuid;--> statement-breakpoint
ALTER TABLE "contact_touchpoints" ADD CONSTRAINT "contact_touchpoints_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_touchpoints" ADD CONSTRAINT "contact_touchpoints_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_logs" ADD CONSTRAINT "integration_logs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_sources" ADD CONSTRAINT "lead_sources_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_touchpoints_contact_idx" ON "contact_touchpoints" USING btree ("contact_id","occurred_at");--> statement-breakpoint
CREATE INDEX "contact_touchpoints_org_idx" ON "contact_touchpoints" USING btree ("org_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_fields_org_key_uq" ON "custom_fields" USING btree ("org_id","key");--> statement-breakpoint
CREATE INDEX "integration_logs_org_idx" ON "integration_logs" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "integration_logs_integration_idx" ON "integration_logs" USING btree ("integration_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_sources_org_key_uq" ON "lead_sources" USING btree ("org_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "products_org_name_uq" ON "products" USING btree ("org_id",lower("name"));--> statement-breakpoint
INSERT INTO "lead_sources" ("org_id", "key", "name", "color", "position")
SELECT o.id, s.key, s.name, s.color, s.position
FROM "organizations" o
CROSS JOIN (VALUES
  ('trafego-pago', 'Tráfego Pago', 'blue', 0),
  ('stories', 'Stories', 'pink', 1),
  ('conteudo-organico', 'Conteúdo Orgânico', 'green', 2),
  ('collab', 'Collab', 'lilac', 3),
  ('indicacao', 'Indicação', 'yellow', 4),
  ('evento', 'Evento', 'orange', 5),
  ('podcast', 'Podcast', 'teal', 6),
  ('outros', 'Outros', 'gray', 7)
) AS s(key, name, color, position)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "custom_fields" ("org_id", "key", "label", "position")
SELECT o.id, f.key, f.label, f.position
FROM "organizations" o
CROSS JOIN (VALUES
  ('faturamento', 'Faturamento', 0),
  ('dor_principal', 'Dor principal', 1),
  ('objetivo', 'Objetivo', 2),
  ('objecoes', 'Objeções', 3)
) AS f(key, label, position)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Formulários existentes eram de anúncio: origem padrão "Tráfego Pago".
UPDATE "lead_forms" lf SET "source_id" = ls.id
FROM "lead_sources" ls
WHERE ls.org_id = lf.org_id AND ls.key = 'trafego-pago' AND lf.source_id IS NULL;
--> statement-breakpoint
UPDATE "leads" l SET "source_id" = lf.source_id
FROM "lead_forms" lf
WHERE lf.id = l.form_id AND l.source_id IS NULL;
--> statement-breakpoint
UPDATE "leads" l SET "source_id" = ls.id
FROM "lead_sources" ls
WHERE ls.org_id = l.org_id AND ls.key = 'trafego-pago' AND l.source_id IS NULL;
--> statement-breakpoint
INSERT INTO "contact_touchpoints" ("org_id", "contact_id", "source_id", "kind", "campaign", "integration_id", "integration_name", "lead_id", "utm", "occurred_at")
SELECT l.org_id, l.contact_id, l.source_id, 'form', l.utm->>'utm_campaign', l.form_id, lf.name, l.id, l.utm, l.created_at
FROM "leads" l LEFT JOIN "lead_forms" lf ON lf.id = l.form_id;
--> statement-breakpoint
UPDATE "contacts" c SET
  "first_source_id" = f.source_id, "first_touch_at" = f.occurred_at,
  "last_source_id" = la.source_id, "last_touch_at" = la.occurred_at
FROM
  (SELECT DISTINCT ON (contact_id) contact_id, source_id, occurred_at FROM "contact_touchpoints" ORDER BY contact_id, occurred_at ASC) f,
  (SELECT DISTINCT ON (contact_id) contact_id, source_id, occurred_at FROM "contact_touchpoints" ORDER BY contact_id, occurred_at DESC) la
WHERE f.contact_id = c.id AND la.contact_id = c.id;
--> statement-breakpoint
UPDATE "lead_forms" lf SET "last_lead_at" = x.m FROM (SELECT form_id, max(created_at) m FROM "leads" WHERE form_id IS NOT NULL GROUP BY form_id) x WHERE x.form_id = lf.id AND lf.last_lead_at IS NULL;
