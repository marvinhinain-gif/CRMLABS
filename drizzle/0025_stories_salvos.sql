CREATE TABLE "instagram_stories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"media_type" text,
	"permalink" text,
	"caption" text,
	"image_id" uuid,
	"posted_at" timestamp with time zone,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instagram_stories" ADD CONSTRAINT "instagram_stories_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_stories" ADD CONSTRAINT "instagram_stories_account_id_connected_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_stories" ADD CONSTRAINT "instagram_stories_image_id_quiz_assets_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."quiz_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "instagram_stories_uq" ON "instagram_stories" USING btree ("account_id","external_id");--> statement-breakpoint
CREATE INDEX "instagram_stories_org_idx" ON "instagram_stories" USING btree ("org_id","posted_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "messages_org_inbound_sent_idx" ON "messages" USING btree ("org_id","sent_at") WHERE direction = 'in';