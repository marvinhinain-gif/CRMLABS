ALTER TABLE "channel_identities" ADD COLUMN "profile_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD COLUMN "dm_backfill_cursor" text;--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD COLUMN "dm_backfill_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD COLUMN "dm_backfill_done_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD COLUMN "dm_backfill_pages" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "relationship_entries" ADD COLUMN "auto_created" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "relationship_entries" ADD COLUMN "origin" text;--> statement-breakpoint
ALTER TABLE "relationship_entries" ADD COLUMN "product_id" uuid;--> statement-breakpoint
ALTER TABLE "relationship_entries" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "relationship_entries" ADD CONSTRAINT "relationship_entries_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_entries" ADD CONSTRAINT "relationship_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_identities_contact_idx" ON "channel_identities" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "channel_identities_ext_idx" ON "channel_identities" USING btree ("org_id","external_id");--> statement-breakpoint
-- Busca do Direct: nome, @ e texto das mensagens (ilike '%termo%' usa índice trigram).
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_name_trgm_idx" ON "contacts" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_username_trgm_idx" ON "contacts" USING gin ("username" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_body_trgm_idx" ON "messages" USING gin ("body" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_contact_idx" ON "conversations" USING btree ("contact_id");--> statement-breakpoint
-- Entradas criadas sozinhas pela regra antiga (mensagem/comentário recebido, sem pessoa responsável):
-- ficam marcadas para revisão do administrador. Nada é apagado.
UPDATE "relationship_entries" re SET "auto_created" = true, "origin" = CASE WHEN sh.reason = 'Comentário recebido' THEN 'instagram_comment' ELSE 'instagram_direct' END
FROM "stage_history" sh
WHERE sh.entity_id = re.id AND sh.entity_type = 'relationship' AND sh.from_stage_id IS NULL AND sh.actor_id IS NULL
  AND sh.reason IN ('Mensagem recebida', 'Comentário recebido');--> statement-breakpoint
UPDATE "relationship_entries" re SET "origin" = CASE WHEN sh.reason = 'Lead criado por comentário' THEN 'instagram_comment' ELSE 'instagram_direct' END, "created_by" = sh.actor_id
FROM "stage_history" sh
WHERE re.origin IS NULL AND sh.entity_id = re.id AND sh.entity_type = 'relationship' AND sh.from_stage_id IS NULL
  AND sh.reason IN ('Lead criado pelo Direct', 'Lead criado por comentário');--> statement-breakpoint
UPDATE "channel_identities" ci SET "profile_checked_at" = now() FROM "contacts" c WHERE c.id = ci.contact_id AND c.avatar_url IS NOT NULL;
