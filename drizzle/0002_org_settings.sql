ALTER TABLE "connected_accounts" ADD COLUMN "app_scoped_id" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "auto_create_from_messages" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "auto_create_from_comments" boolean DEFAULT false NOT NULL;