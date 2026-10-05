ALTER TABLE "conversations" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "resolved_by" uuid;--> statement-breakpoint
ALTER TABLE "social_comments" ADD COLUMN "like_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "social_comments" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "social_comments" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "social_comments" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "social_comments" ADD COLUMN "resolved_by" uuid;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "media_url" text;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "like_count" integer;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "comments_count" integer;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "refreshed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_comments" ADD CONSTRAINT "social_comments_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;