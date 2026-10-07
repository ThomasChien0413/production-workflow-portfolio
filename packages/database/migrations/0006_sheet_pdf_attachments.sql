CREATE TYPE "public"."sheet_attachment_state" AS ENUM('PENDING_UPLOAD', 'AVAILABLE', 'REMOVED', 'FAILED_CLEANUP');

CREATE TABLE "sheet_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sheet_id" uuid NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"original_filename" varchar(255) NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" char(64) NOT NULL,
	"storage_key" text NOT NULL,
	"storage_version_id" text,
	"state" "sheet_attachment_state" DEFAULT 'PENDING_UPLOAD' NOT NULL,
	"available_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"removed_by_user_id" uuid,
	"deleted_at" timestamp with time zone,
	"cleanup_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sheet_attachments_size_check" CHECK ("size_bytes" > 0 AND "size_bytes" <= 104857600),
	CONSTRAINT "sheet_attachments_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "sheet_attachment_mutations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"sheet_id" uuid NOT NULL,
	"attachment_id" uuid,
	"action" varchar(32) NOT NULL,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sheet_attachment_mutations_action_check" CHECK ("action" IN ('UPLOAD', 'REMOVE')),
	CONSTRAINT "sheet_attachment_mutations_status_check" CHECK ("status" IN ('PENDING', 'COMPLETED', 'FAILED'))
);

ALTER TABLE "sheet_attachments" ADD CONSTRAINT "sheet_attachments_sheet_id_production_sheets_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."production_sheets"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "sheet_attachments" ADD CONSTRAINT "sheet_attachments_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "sheet_attachments" ADD CONSTRAINT "sheet_attachments_removed_by_user_id_users_id_fk" FOREIGN KEY ("removed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "sheet_attachment_mutations" ADD CONSTRAINT "sheet_attachment_mutations_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "sheet_attachment_mutations" ADD CONSTRAINT "sheet_attachment_mutations_sheet_id_production_sheets_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."production_sheets"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "sheet_attachment_mutations" ADD CONSTRAINT "sheet_attachment_mutations_attachment_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."sheet_attachments"("id") ON DELETE cascade ON UPDATE no action;

CREATE UNIQUE INDEX "sheet_attachments_storage_key_unique" ON "sheet_attachments" USING btree ("storage_key");
CREATE INDEX "sheet_attachments_sheet_state_created_idx" ON "sheet_attachments" USING btree ("sheet_id", "state", "created_at");
CREATE UNIQUE INDEX "sheet_attachment_mutations_actor_key_unique" ON "sheet_attachment_mutations" USING btree ("actor_user_id", "idempotency_key");
CREATE INDEX "sheet_attachment_mutations_sheet_idx" ON "sheet_attachment_mutations" USING btree ("sheet_id");
