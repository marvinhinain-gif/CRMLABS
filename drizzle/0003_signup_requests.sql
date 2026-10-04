ALTER TYPE "public"."membership_status" ADD VALUE 'pending';--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "request_note" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "allow_signup" boolean DEFAULT true NOT NULL;