CREATE TABLE "data_subject_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text,
	"email" text,
	"phone" text,
	"message" text,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"question_key" text NOT NULL,
	"question_title" text NOT NULL,
	"type" text NOT NULL,
	"value" jsonb,
	"display_value" text,
	"option_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"points" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"data" "bytea" NOT NULL,
	"mime" text NOT NULL,
	"width" integer,
	"height" integer,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"contact_id" uuid,
	"kind" text NOT NULL,
	"granted" boolean NOT NULL,
	"text_version" text NOT NULL,
	"text" text NOT NULL,
	"policy_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"version_id" uuid,
	"session_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"channel" text DEFAULT 'link' NOT NULL,
	"utm_source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_form_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"max_points" integer DEFAULT 0 NOT NULL,
	"published_by" uuid,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"draft" jsonb NOT NULL,
	"draft_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"live_version_id" uuid,
	"latest_version_id" uuid,
	"published_at" timestamp with time zone,
	"lead_form_id" uuid,
	"allowed_domains" text[] DEFAULT '{}'::text[] NOT NULL,
	"template_key" text,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"version_id" uuid,
	"action" text NOT NULL,
	"slug" text NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"key" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"required" boolean NOT NULL,
	"scored" boolean NOT NULL,
	"crm_field" text NOT NULL,
	"show_if" jsonb,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_score_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"raw_points" integer NOT NULL,
	"max_points" integer NOT NULL,
	"score" integer,
	"tier_id" text,
	"tier_label" text,
	"reason" text NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_scoring_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"tier_key" text NOT NULL,
	"label" text NOT NULL,
	"min_score" integer NOT NULL,
	"requirements" jsonb NOT NULL,
	"route" jsonb NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"contact_id" uuid,
	"lead_id" uuid,
	"name" text,
	"email" text,
	"phone" text,
	"instagram" text,
	"company" text,
	"answers" jsonb NOT NULL,
	"raw_points" integer DEFAULT 0 NOT NULL,
	"max_points" integer DEFAULT 0 NOT NULL,
	"score" integer,
	"tier_id" text,
	"tier_label" text,
	"classification" jsonb,
	"scored_with_version_id" uuid,
	"channel" text DEFAULT 'link' NOT NULL,
	"utm" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"referrer" text,
	"route" jsonb,
	"ip_hash" text,
	"user_agent" text,
	"duplicate_of" uuid,
	"anonymized_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_answers" ADD CONSTRAINT "quiz_answers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_answers" ADD CONSTRAINT "quiz_answers_submission_id_quiz_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."quiz_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_assets" ADD CONSTRAINT "quiz_assets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_assets" ADD CONSTRAINT "quiz_assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_consents" ADD CONSTRAINT "quiz_consents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_consents" ADD CONSTRAINT "quiz_consents_submission_id_quiz_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."quiz_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_consents" ADD CONSTRAINT "quiz_consents_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_events" ADD CONSTRAINT "quiz_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_events" ADD CONSTRAINT "quiz_events_form_id_quiz_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."quiz_forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_form_versions" ADD CONSTRAINT "quiz_form_versions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_form_versions" ADD CONSTRAINT "quiz_form_versions_form_id_quiz_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."quiz_forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_form_versions" ADD CONSTRAINT "quiz_form_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_forms" ADD CONSTRAINT "quiz_forms_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_forms" ADD CONSTRAINT "quiz_forms_lead_form_id_lead_forms_id_fk" FOREIGN KEY ("lead_form_id") REFERENCES "public"."lead_forms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_forms" ADD CONSTRAINT "quiz_forms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_options" ADD CONSTRAINT "quiz_options_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_options" ADD CONSTRAINT "quiz_options_question_id_quiz_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."quiz_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_publications" ADD CONSTRAINT "quiz_publications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_publications" ADD CONSTRAINT "quiz_publications_form_id_quiz_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."quiz_forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_version_id_quiz_form_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."quiz_form_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_section_id_quiz_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."quiz_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_score_history" ADD CONSTRAINT "quiz_score_history_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_score_history" ADD CONSTRAINT "quiz_score_history_submission_id_quiz_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."quiz_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_scoring_rules" ADD CONSTRAINT "quiz_scoring_rules_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_scoring_rules" ADD CONSTRAINT "quiz_scoring_rules_version_id_quiz_form_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."quiz_form_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_sections" ADD CONSTRAINT "quiz_sections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_sections" ADD CONSTRAINT "quiz_sections_version_id_quiz_form_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."quiz_form_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_submissions" ADD CONSTRAINT "quiz_submissions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_submissions" ADD CONSTRAINT "quiz_submissions_form_id_quiz_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."quiz_forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_submissions" ADD CONSTRAINT "quiz_submissions_version_id_quiz_form_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."quiz_form_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_submissions" ADD CONSTRAINT "quiz_submissions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_submissions" ADD CONSTRAINT "quiz_submissions_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_subject_requests_org_idx" ON "data_subject_requests" USING btree ("org_id","status","created_at");--> statement-breakpoint
CREATE INDEX "quiz_answers_submission_idx" ON "quiz_answers" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "quiz_answers_question_idx" ON "quiz_answers" USING btree ("org_id","question_key");--> statement-breakpoint
CREATE INDEX "quiz_consents_contact_idx" ON "quiz_consents" USING btree ("contact_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_events_uq" ON "quiz_events" USING btree ("form_id","session_id","kind");--> statement-breakpoint
CREATE INDEX "quiz_events_form_idx" ON "quiz_events" USING btree ("form_id","kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_form_versions_uq" ON "quiz_form_versions" USING btree ("form_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_forms_slug_uq" ON "quiz_forms" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "quiz_forms_org_idx" ON "quiz_forms" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_options_uq" ON "quiz_options" USING btree ("question_id","key");--> statement-breakpoint
CREATE INDEX "quiz_publications_form_idx" ON "quiz_publications" USING btree ("form_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_questions_uq" ON "quiz_questions" USING btree ("version_id","key");--> statement-breakpoint
CREATE INDEX "quiz_score_history_submission_idx" ON "quiz_score_history" USING btree ("submission_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_scoring_rules_uq" ON "quiz_scoring_rules" USING btree ("version_id","tier_key");--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_sections_uq" ON "quiz_sections" USING btree ("version_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_submissions_session_uq" ON "quiz_submissions" USING btree ("form_id","session_id");--> statement-breakpoint
CREATE INDEX "quiz_submissions_form_idx" ON "quiz_submissions" USING btree ("form_id","completed_at");--> statement-breakpoint
CREATE INDEX "quiz_submissions_contact_idx" ON "quiz_submissions" USING btree ("contact_id","completed_at");--> statement-breakpoint
CREATE INDEX "quiz_submissions_org_idx" ON "quiz_submissions" USING btree ("org_id","completed_at");--> statement-breakpoint
-- Versões publicadas e histórico de score não podem ser alterados (respostas antigas preservadas).
CREATE OR REPLACE FUNCTION crmlabs_block_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Registro imutável em %', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER quiz_form_versions_immutable BEFORE UPDATE ON quiz_form_versions
  FOR EACH ROW EXECUTE FUNCTION crmlabs_block_update();
--> statement-breakpoint
CREATE TRIGGER quiz_score_history_immutable BEFORE UPDATE ON quiz_score_history
  FOR EACH ROW EXECUTE FUNCTION crmlabs_block_update();
