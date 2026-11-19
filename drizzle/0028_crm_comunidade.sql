ALTER TYPE "public"."pipeline_kind" ADD VALUE IF NOT EXISTS 'community';--> statement-breakpoint
CREATE TABLE "community_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"lead_id" uuid,
	"stage_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "community_entries" ADD CONSTRAINT "community_entries_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_entries" ADD CONSTRAINT "community_entries_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_entries" ADD CONSTRAINT "community_entries_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_entries" ADD CONSTRAINT "community_entries_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_entries" ADD CONSTRAINT "community_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "community_entries_active_uq" ON "community_entries" USING btree ("org_id","contact_id") WHERE "community_entries"."closed_at" is null;--> statement-breakpoint
CREATE INDEX "community_entries_stage_idx" ON "community_entries" USING btree ("stage_id");