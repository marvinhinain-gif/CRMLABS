-- Histórico de movimentação e auditoria são imutáveis: bloqueia UPDATE e DELETE.
-- (A exclusão em cascata da organização inteira continua permitida via TRUNCATE/DELETE da org
--  porque o trigger só bloqueia operações diretas quando a org ainda existe.)
CREATE OR REPLACE FUNCTION crmlabs_block_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.org_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Registro imutável em %', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER stage_history_immutable BEFORE UPDATE OR DELETE ON stage_history
  FOR EACH ROW EXECUTE FUNCTION crmlabs_block_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_events_immutable BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION crmlabs_block_mutation();
