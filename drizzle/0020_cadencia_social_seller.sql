CREATE TABLE "cadence_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"entry_id" uuid,
	"step_id" uuid,
	"step_name" text,
	"outcome" text NOT NULL,
	"note" text,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cadence_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"channel" text NOT NULL,
	"wait_days" integer DEFAULT 0 NOT NULL,
	"script" text DEFAULT '' NOT NULL,
	"position" integer NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "relationship_entries" ADD COLUMN "cadence_step_id" uuid;--> statement-breakpoint
ALTER TABLE "relationship_entries" ADD COLUMN "cadence_status" text;--> statement-breakpoint
ALTER TABLE "relationship_entries" ADD COLUMN "cadence_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "relationship_entries" ADD COLUMN "cadence_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cadence_activities" ADD CONSTRAINT "cadence_activities_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadence_activities" ADD CONSTRAINT "cadence_activities_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadence_activities" ADD CONSTRAINT "cadence_activities_entry_id_relationship_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."relationship_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadence_activities" ADD CONSTRAINT "cadence_activities_step_id_cadence_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."cadence_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadence_activities" ADD CONSTRAINT "cadence_activities_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadence_steps" ADD CONSTRAINT "cadence_steps_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cadence_activities_contact_idx" ON "cadence_activities" USING btree ("contact_id","created_at");--> statement-breakpoint
CREATE INDEX "cadence_activities_org_idx" ON "cadence_activities" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cadence_steps_org_key_uq" ON "cadence_steps" USING btree ("org_id","key");--> statement-breakpoint
ALTER TABLE "relationship_entries" ADD CONSTRAINT "relationship_entries_cadence_step_id_cadence_steps_id_fk" FOREIGN KEY ("cadence_step_id") REFERENCES "public"."cadence_steps"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- Passos padrão da cadência para toda organização que ainda não tem nenhum.
INSERT INTO "cadence_steps" ("org_id", "key", "name", "channel", "wait_days", "script", "position")
SELECT o."id", d."key", d."name", d."channel", d."wait_days", d."script", d."position"
FROM "organizations" o
CROSS JOIN (VALUES
  ('ligacao-1', 'Ligação 1', 'call', 0, 'O que fazer: ligue assim que o lead entrar. Objetivo: qualificar (momento, faturamento, maior desafio) e agendar a sessão estratégica.
O que falar: "Oi {nome}, tudo bem? Aqui é {responsavel}, da AXION. Vi que você demonstrou interesse e queria entender melhor o seu momento. Tem 2 minutos?"
Se não atender: registre "Não atendeu" e mande já a Mensagem 1.', 0),
  ('mensagem-1', 'Mensagem 1', 'whatsapp', 0, 'O que fazer: mande logo depois da ligação não atendida.
O que mandar: "Oi {nome}, tudo bem? Aqui é {responsavel}, da AXION. Acabei de te ligar para entender melhor o seu momento e ver como podemos te ajudar. Qual o melhor horário pra conversarmos?"', 1),
  ('mensagem-2', 'Mensagem 2', 'whatsapp', 1, 'O que fazer: mande no dia seguinte, com algo de valor e uma pergunta curta.
O que mandar: "{nome}, separei um conteúdo rápido que ajuda quem está no seu momento a destravar o próximo nível. Hoje, qual é o seu maior desafio no negócio?"', 2),
  ('ligacao-2', 'Ligação 2', 'call', 1, 'O que fazer: tente de novo em outro horário (se ligou de manhã, ligue no fim da tarde, e vice-versa).
O que falar: "Oi {nome}, é {responsavel}, da AXION, tentei falar com você ontem. Consegue conversar agora por alguns minutos?"
Se não atender: registre e siga para o próximo follow-up.', 3),
  ('follow-up-1', 'Follow-up 1', 'whatsapp', 2, 'O que fazer: retome com uma prova social curta e convide para a sessão estratégica.
O que mandar: "Oi {nome}, é {responsavel}, da AXION. Ajudamos clientes em situação parecida com a sua a organizar as vendas e crescer com previsibilidade. Que tal uma sessão estratégica rápida para ver se faz sentido pra você?"', 4),
  ('follow-up-final', 'Follow-up final', 'whatsapp', 3, 'O que fazer: encerre a cadência com educação, deixando a porta aberta.
O que mandar: "{nome}, tudo bem? Não quero te incomodar, então vou encerrar por aqui. Se fizer sentido conversar mais pra frente, é só me responder por aqui. Abraço, {responsavel}."', 5)
) AS d("key", "name", "channel", "wait_days", "script", "position")
WHERE NOT EXISTS (SELECT 1 FROM "cadence_steps" c WHERE c."org_id" = o."id");
