CREATE TABLE "engagement_cursors" (
	"source" text PRIMARY KEY NOT NULL,
	"last_at" timestamp with time zone,
	"last_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engagement_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"account_id" uuid,
	"actor_key" text NOT NULL,
	"kind" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"message_id" uuid,
	"comment_id" uuid,
	"username" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engagement_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"weights" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"daily_cap" integer DEFAULT 5 NOT NULL,
	"closers_can_view" boolean DEFAULT false NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "engagement_events" ADD CONSTRAINT "engagement_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_events" ADD CONSTRAINT "engagement_events_account_id_connected_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_events" ADD CONSTRAINT "engagement_events_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_events" ADD CONSTRAINT "engagement_events_comment_id_social_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."social_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_settings" ADD CONSTRAINT "engagement_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_settings" ADD CONSTRAINT "engagement_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "engagement_events_message_uq" ON "engagement_events" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "engagement_events_comment_uq" ON "engagement_events" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "engagement_events_org_idx" ON "engagement_events" USING btree ("org_id","occurred_at");--> statement-breakpoint
CREATE INDEX "engagement_events_actor_idx" ON "engagement_events" USING btree ("org_id","actor_key","occurred_at");--> statement-breakpoint
CREATE INDEX "messages_created_idx" ON "messages" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "social_comments_created_idx" ON "social_comments" USING btree ("created_at","id");