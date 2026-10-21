ALTER TABLE "leads" ADD COLUMN "suggested_stage_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_suggested_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("suggested_stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Coluna "Fora do ICP" no Kanban do Social Seller de cada organização (no fim; quem já tem uma etapa com esse nome fica como está).
INSERT INTO "pipeline_stages" ("org_id", "pipeline_id", "key", "name", "color", "position", "stage_type")
SELECT p."org_id", p."id", 'fora-do-icp', 'Fora do ICP', 'gray',
  coalesce((SELECT max(s."position") FROM "pipeline_stages" s WHERE s."pipeline_id" = p."id"), -1) + 1, 'custom'
FROM "pipelines" p
WHERE p."kind" = 'relationship' AND p."owner_id" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "pipeline_stages" s
    WHERE s."pipeline_id" = p."id" AND (s."key" = 'fora-do-icp' OR (lower(s."name") = 'fora do icp' AND s."archived_at" IS NULL))
  );
