-- Leads chegam sem responsável: só fica com responsável quem já está no Kanban de um SDR.
-- 1) Lead que já está no Kanban e ainda aparecia como novo/sem resposta passa a "em contato".
UPDATE "leads" l SET "status" = 'contacted', "contacted_at" = coalesce(l."contacted_at", now()), "updated_at" = now()
WHERE l."status" IN ('new', 'no_answer')
  AND EXISTS (SELECT 1 FROM "relationship_entries" re WHERE re."contact_id" = l."contact_id" AND re."closed_at" IS NULL AND NOT re."auto_created");
--> statement-breakpoint
-- 2) Lead fora do Kanban (e sem reunião marcada) volta para a fila, sem responsável.
UPDATE "leads" l SET "assigned_to" = NULL, "updated_at" = now()
WHERE l."assigned_to" IS NOT NULL AND l."status" <> 'scheduled'
  AND NOT EXISTS (SELECT 1 FROM "relationship_entries" re WHERE re."contact_id" = l."contact_id" AND re."closed_at" IS NULL AND NOT re."auto_created");
--> statement-breakpoint
-- 3) O contato desses leads também fica sem dono (as conversas do Instagram continuam com quem já cuidava delas).
UPDATE "contacts" c SET "owner_id" = NULL, "updated_at" = now()
WHERE c."owner_id" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "leads" l WHERE l."contact_id" = c."id")
  AND NOT EXISTS (SELECT 1 FROM "leads" l WHERE l."contact_id" = c."id" AND l."status" = 'scheduled')
  AND NOT EXISTS (SELECT 1 FROM "relationship_entries" re WHERE re."contact_id" = c."id" AND re."closed_at" IS NULL AND NOT re."auto_created")
  AND NOT EXISTS (SELECT 1 FROM "opportunities" o WHERE o."contact_id" = c."id" AND o."status" = 'open');
