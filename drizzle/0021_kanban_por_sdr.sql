-- Coluna "Contato" como primeira etapa do Kanban do Social Seller de cada organização
-- (para onde o lead vai quando o SDR o encaminha ao próprio Kanban). Quem já tem uma etapa assim fica como está.
INSERT INTO "pipeline_stages" ("org_id", "pipeline_id", "key", "name", "color", "position", "stage_type")
SELECT p."org_id", p."id", 'contato', 'Contato', 'blue',
  coalesce((SELECT min(s."position") FROM "pipeline_stages" s WHERE s."pipeline_id" = p."id"), 1) - 1, 'custom'
FROM "pipelines" p
WHERE p."kind" = 'relationship' AND p."owner_id" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "pipeline_stages" s
    WHERE s."pipeline_id" = p."id" AND (s."key" = 'contato' OR (lower(s."name") = 'contato' AND s."archived_at" IS NULL))
  );
