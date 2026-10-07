CREATE TABLE "line_auth_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"state_hash" char(64) NOT NULL,
	"nonce" varchar(128) NOT NULL,
	"code_verifier" varchar(128) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "line_webhook_events" (
	"webhook_event_id" varchar(128) PRIMARY KEY NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"source_line_user_id" varchar(64),
	"event_timestamp" timestamp with time zone NOT NULL,
	"is_redelivery" boolean DEFAULT false NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "line_connections" ADD COLUMN "friendship_event_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "line_auth_attempts" ADD CONSTRAINT "line_auth_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "line_auth_attempts_state_hash_unique" ON "line_auth_attempts" USING btree ("state_hash");--> statement-breakpoint
CREATE INDEX "line_auth_attempts_user_expiry_idx" ON "line_auth_attempts" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE INDEX "line_webhook_events_processed_idx" ON "line_webhook_events" USING btree ("processed_at");