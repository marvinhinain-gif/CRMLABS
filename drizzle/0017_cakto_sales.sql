ALTER TYPE "public"."contact_source" ADD VALUE 'checkout';--> statement-breakpoint
CREATE TABLE "checkout_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"provider" text DEFAULT 'cakto' NOT NULL,
	"token_hash" text NOT NULL,
	"token_enc" text NOT NULL,
	"webhook_secret_enc" text,
	"api_client_id_enc" text,
	"api_client_secret_enc" text,
	"last_event_at" timestamp with time zone,
	"last_import_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checkout_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"provider" text DEFAULT 'cakto' NOT NULL,
	"external_id" text NOT NULL,
	"ref_id" text,
	"status" text NOT NULL,
	"last_event" text,
	"contact_id" uuid,
	"customer_name" text,
	"customer_email" text,
	"customer_phone" text,
	"product_external_id" text,
	"product_name" text,
	"offer_name" text,
	"offer_type" text,
	"amount_cents" bigint DEFAULT 0 NOT NULL,
	"base_amount_cents" bigint,
	"fees_cents" bigint,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"payment_method" text,
	"installments" integer,
	"utm" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_id" uuid,
	"source_via" text,
	"campaign" text,
	"ordered_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"chargedback_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "checkout_integrations" ADD CONSTRAINT "checkout_integrations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_orders" ADD CONSTRAINT "checkout_orders_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_orders" ADD CONSTRAINT "checkout_orders_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_integrations_org_provider_uq" ON "checkout_integrations" USING btree ("org_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_integrations_token_uq" ON "checkout_integrations" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_orders_ext_uq" ON "checkout_orders" USING btree ("org_id","provider","external_id");--> statement-breakpoint
CREATE INDEX "checkout_orders_org_paid_idx" ON "checkout_orders" USING btree ("org_id","paid_at");--> statement-breakpoint
CREATE INDEX "checkout_orders_contact_idx" ON "checkout_orders" USING btree ("contact_id");