ALTER TABLE "channel_identities" ADD COLUMN "follows_business" boolean;--> statement-breakpoint
ALTER TABLE "channel_identities" ADD COLUMN "follow_first_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channel_identities" ADD COLUMN "follow_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channel_identities" ADD COLUMN "follower_count" integer;--> statement-breakpoint
ALTER TABLE "quiz_events" ADD COLUMN "link_key" text;--> statement-breakpoint
ALTER TABLE "quiz_forms" ADD COLUMN "links" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "quiz_score_history" ADD COLUMN "product_label" text;--> statement-breakpoint
ALTER TABLE "quiz_submissions" ADD COLUMN "link_key" text;--> statement-breakpoint
ALTER TABLE "quiz_submissions" ADD COLUMN "link_label" text;--> statement-breakpoint
ALTER TABLE "quiz_submissions" ADD COLUMN "product_id" text;--> statement-breakpoint
ALTER TABLE "quiz_submissions" ADD COLUMN "product_label" text;--> statement-breakpoint
ALTER TABLE "quiz_submissions" ADD COLUMN "recommendation" jsonb;--> statement-breakpoint
ALTER TABLE "quiz_submissions" ADD COLUMN "override" jsonb;