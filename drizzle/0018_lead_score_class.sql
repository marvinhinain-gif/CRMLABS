ALTER TABLE "leads" ADD COLUMN "score_class" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "score_class_by" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "score_class_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_score_class_by_users_id_fk" FOREIGN KEY ("score_class_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;