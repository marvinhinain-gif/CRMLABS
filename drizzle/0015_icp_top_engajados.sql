CREATE TABLE "engagement_icp" (
	"org_id" uuid NOT NULL,
	"actor_key" text NOT NULL,
	"is_icp" boolean NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "engagement_icp_org_id_actor_key_pk" PRIMARY KEY("org_id","actor_key")
);
--> statement-breakpoint
ALTER TABLE "engagement_icp" ADD CONSTRAINT "engagement_icp_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_icp" ADD CONSTRAINT "engagement_icp_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;