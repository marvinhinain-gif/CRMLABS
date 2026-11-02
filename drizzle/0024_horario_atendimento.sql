ALTER TABLE "memberships" ADD COLUMN "work_start" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "work_end" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "work_start" text DEFAULT '08:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "work_end" text DEFAULT '20:00' NOT NULL;