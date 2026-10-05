CREATE TYPE "public"."lead_status" AS ENUM('new', 'contacted', 'scheduled', 'no_answer', 'disqualified');--> statement-breakpoint
ALTER TYPE "public"."contact_source" ADD VALUE 'lead_form';--> statement-breakpoint
CREATE TABLE "lead_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"headline" text NOT NULL,
	"description" text,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ask_email" boolean DEFAULT true NOT NULL,
	"ask_instagram" boolean DEFAULT true NOT NULL,
	"ask_preferred_time" boolean DEFAULT true NOT NULL,
	"thank_you" text,
	"assignee_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rotation" integer DEFAULT 0 NOT NULL,
	"stage_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"token_hash" text NOT NULL,
	"token_enc" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"form_id" uuid,
	"contact_id" uuid NOT NULL,
	"assigned_to" uuid,
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"instagram" text,
	"answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferred_at" timestamp with time zone,
	"preferred_text" text,
	"utm" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"channel" text DEFAULT 'form' NOT NULL,
	"appointment_id" uuid,
	"contacted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "lead_id" uuid;--> statement-breakpoint
ALTER TABLE "lead_forms" ADD CONSTRAINT "lead_forms_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_form_id_lead_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."lead_forms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lead_forms_slug_uq" ON "lead_forms" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_forms_token_uq" ON "lead_forms" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "lead_forms_org_idx" ON "lead_forms" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "leads_org_idx" ON "leads" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "leads_assigned_idx" ON "leads" USING btree ("org_id","assigned_to","status");