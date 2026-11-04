ALTER TABLE "leads" ADD COLUMN "share_token" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "shared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "shared_by" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_shared_by_users_id_fk" FOREIGN KEY ("shared_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "leads_share_token_uq" ON "leads" USING btree ("share_token");