CREATE TABLE "calendar_connections" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"feed_token_hash" text NOT NULL,
	"feed_token_enc" text NOT NULL,
	"google_email" text,
	"google_refresh_enc" text,
	"google_calendar_id" text DEFAULT 'primary' NOT NULL,
	"create_meet" boolean DEFAULT true NOT NULL,
	"google_connected_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "google_event_id" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "calendar_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD COLUMN "purpose" text DEFAULT 'instagram' NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_connections_feed_uq" ON "calendar_connections" USING btree ("feed_token_hash");