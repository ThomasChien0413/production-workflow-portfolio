CREATE TYPE "public"."app_role" AS ENUM('ADMIN', 'GENERAL_MANAGER', 'ASSOCIATE', 'SALES');--> statement-breakpoint
CREATE TYPE "public"."approval_decision" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."approval_run_state" AS ENUM('PENDING', 'APPROVED', 'RETURNED', 'INVALIDATED');--> statement-breakpoint
CREATE TYPE "public"."line_connection_state" AS ENUM('PENDING', 'CONNECTED', 'UNFRIENDED', 'DISCONNECTED', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."department_membership_kind" AS ENUM('MANAGER', 'STAFF');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('IN_APP', 'LINE');--> statement-breakpoint
CREATE TYPE "public"."notification_state" AS ENUM('PENDING', 'DELIVERED', 'FAILED', 'READ');--> statement-breakpoint
CREATE TYPE "public"."outbox_state" AS ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."sheet_state" AS ENUM('DRAFT', 'PENDING_SALES', 'PENDING_ASSOCIATE', 'PENDING_GENERAL_MANAGER', 'READY', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'RETURNED', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "approval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sheet_id" uuid NOT NULL,
	"run_number" integer NOT NULL,
	"status" "approval_run_state" DEFAULT 'PENDING' NOT NULL,
	"reviewed_data_fingerprint" char(64) NOT NULL,
	"submitted_by_user_id" uuid NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "approval_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"approval_run_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"required_role" "app_role" NOT NULL,
	"reviewer_user_id" uuid,
	"decision" "approval_decision" DEFAULT 'PENDING' NOT NULL,
	"comment" text,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"action" varchar(128) NOT NULL,
	"target_type" varchar(64) NOT NULL,
	"target_id" varchar(128),
	"request_id" varchar(64),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_address" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "department_memberships" (
	"user_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"kind" "department_membership_kind" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "department_memberships_user_id_department_id_pk" PRIMARY KEY("user_id","department_id")
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(32) NOT NULL,
	"slug" varchar(64) NOT NULL,
	"display_name" varchar(64) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "line_connections" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"line_user_id" varchar(64) NOT NULL,
	"state" "line_connection_state" DEFAULT 'PENDING' NOT NULL,
	"is_friend" boolean DEFAULT false NOT NULL,
	"access_token_ciphertext" text,
	"refresh_token_ciphertext" text,
	"token_expires_at" timestamp with time zone,
	"connected_at" timestamp with time zone,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"outcome" varchar(64) NOT NULL,
	"provider_status_code" integer,
	"sanitized_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"sheet_id" uuid,
	"channel" "notification_channel" NOT NULL,
	"event_type" varchar(96) NOT NULL,
	"summary" varchar(500) NOT NULL,
	"deep_link" text,
	"state" "notification_state" DEFAULT 'PENDING' NOT NULL,
	"deduplication_key" varchar(255) NOT NULL,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_type" varchar(96) NOT NULL,
	"payload" jsonb NOT NULL,
	"state" "outbox_state" DEFAULT 'PENDING' NOT NULL,
	"deduplication_key" varchar(255) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" varchar(128),
	"completed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_sheets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sheet_number" varchar(64) NOT NULL,
	"template_version_id" uuid NOT NULL,
	"origin_department_id" uuid NOT NULL,
	"current_department_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"assigned_user_id" uuid,
	"state" "sheet_state" DEFAULT 'DRAFT' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_assignments" (
	"user_id" uuid NOT NULL,
	"role" "app_role" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_assignments_user_id_role_pk" PRIMARY KEY("user_id","role")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" char(64) NOT NULL,
	"csrf_token_hash" char(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip_address" varchar(64),
	"user_agent" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sheet_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sheet_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"assigned_user_id" uuid NOT NULL,
	"assigned_by_user_id" uuid NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sheet_client_mutations" (
	"sheet_id" uuid NOT NULL,
	"client_mutation_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sheet_client_mutations_sheet_id_client_mutation_id_pk" PRIMARY KEY("sheet_id","client_mutation_id")
);
--> statement-breakpoint
CREATE TABLE "sheet_field_versions" (
	"sheet_id" uuid NOT NULL,
	"field_key" varchar(128) NOT NULL,
	"version" integer NOT NULL,
	"updated_by_user_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sheet_field_versions_sheet_id_field_key_pk" PRIMARY KEY("sheet_id","field_key")
);
--> statement-breakpoint
CREATE TABLE "sheet_handoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sheet_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"source_department_id" uuid NOT NULL,
	"destination_department_id" uuid NOT NULL,
	"sent_by_user_id" uuid NOT NULL,
	"note" text,
	"prior_assignment" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sheet_route_participants" (
	"sheet_id" uuid NOT NULL,
	"manager_user_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sheet_route_participants_sheet_id_manager_user_id_pk" PRIMARY KEY("sheet_id","manager_user_id")
);
--> statement-breakpoint
CREATE TABLE "sheet_template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"requires_review" boolean DEFAULT false NOT NULL,
	"source_reference" text,
	"change_notes" text,
	"published_by_user_id" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sheet_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"department_id" uuid NOT NULL,
	"slug" varchar(96) NOT NULL,
	"display_name" varchar(160) NOT NULL,
	"description" text,
	"active" boolean DEFAULT false NOT NULL,
	"current_version_number" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sheet_values" (
	"sheet_id" uuid PRIMARY KEY NOT NULL,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar(64) NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"password_hash" text NOT NULL,
	"password_warning" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"failed_login_attempts" integer DEFAULT 0 NOT NULL,
	"failed_login_window_started_at" timestamp with time zone,
	"locked_until" timestamp with time zone,
	"password_changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_runs" ADD CONSTRAINT "approval_runs_sheet_id_production_sheets_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."production_sheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_runs" ADD CONSTRAINT "approval_runs_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_approval_run_id_approval_runs_id_fk" FOREIGN KEY ("approval_run_id") REFERENCES "public"."approval_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_memberships" ADD CONSTRAINT "department_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_memberships" ADD CONSTRAINT "department_memberships_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_connections" ADD CONSTRAINT "line_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_attempts" ADD CONSTRAINT "notification_attempts_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_sheet_id_production_sheets_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."production_sheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_sheets" ADD CONSTRAINT "production_sheets_template_version_id_sheet_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."sheet_template_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_sheets" ADD CONSTRAINT "production_sheets_origin_department_id_departments_id_fk" FOREIGN KEY ("origin_department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_sheets" ADD CONSTRAINT "production_sheets_current_department_id_departments_id_fk" FOREIGN KEY ("current_department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_sheets" ADD CONSTRAINT "production_sheets_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_sheets" ADD CONSTRAINT "production_sheets_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_assignments" ADD CONSTRAINT "sheet_assignments_sheet_id_production_sheets_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."production_sheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_assignments" ADD CONSTRAINT "sheet_assignments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_assignments" ADD CONSTRAINT "sheet_assignments_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_assignments" ADD CONSTRAINT "sheet_assignments_assigned_by_user_id_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_client_mutations" ADD CONSTRAINT "sheet_client_mutations_sheet_id_production_sheets_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."production_sheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_client_mutations" ADD CONSTRAINT "sheet_client_mutations_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_field_versions" ADD CONSTRAINT "sheet_field_versions_sheet_id_production_sheets_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."production_sheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_field_versions" ADD CONSTRAINT "sheet_field_versions_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_handoffs" ADD CONSTRAINT "sheet_handoffs_sheet_id_production_sheets_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."production_sheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_handoffs" ADD CONSTRAINT "sheet_handoffs_source_department_id_departments_id_fk" FOREIGN KEY ("source_department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_handoffs" ADD CONSTRAINT "sheet_handoffs_destination_department_id_departments_id_fk" FOREIGN KEY ("destination_department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_handoffs" ADD CONSTRAINT "sheet_handoffs_sent_by_user_id_users_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_route_participants" ADD CONSTRAINT "sheet_route_participants_sheet_id_production_sheets_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."production_sheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_route_participants" ADD CONSTRAINT "sheet_route_participants_manager_user_id_users_id_fk" FOREIGN KEY ("manager_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_route_participants" ADD CONSTRAINT "sheet_route_participants_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_template_versions" ADD CONSTRAINT "sheet_template_versions_template_id_sheet_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."sheet_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_template_versions" ADD CONSTRAINT "sheet_template_versions_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_templates" ADD CONSTRAINT "sheet_templates_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_values" ADD CONSTRAINT "sheet_values_sheet_id_production_sheets_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."production_sheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_runs_sheet_number_unique" ON "approval_runs" USING btree ("sheet_id","run_number");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_steps_run_sequence_unique" ON "approval_steps" USING btree ("approval_run_id","sequence");--> statement-breakpoint
CREATE INDEX "audit_events_target_idx" ON "audit_events" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_events_created_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "department_memberships_department_idx" ON "department_memberships" USING btree ("department_id","kind","active");--> statement-breakpoint
CREATE UNIQUE INDEX "departments_code_unique" ON "departments" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "departments_slug_unique" ON "departments" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "line_connections_user_id_unique" ON "line_connections" USING btree ("line_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_attempt_number_unique" ON "notification_attempts" USING btree ("notification_id","attempt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_deduplication_unique" ON "notifications" USING btree ("deduplication_key");--> statement-breakpoint
CREATE INDEX "notifications_recipient_state_idx" ON "notifications" USING btree ("recipient_user_id","state","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_jobs_deduplication_unique" ON "outbox_jobs" USING btree ("deduplication_key");--> statement-breakpoint
CREATE INDEX "outbox_jobs_claim_idx" ON "outbox_jobs" USING btree ("state","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "production_sheets_number_unique" ON "production_sheets" USING btree ("sheet_number");--> statement-breakpoint
CREATE INDEX "production_sheets_department_state_idx" ON "production_sheets" USING btree ("current_department_id","state");--> statement-breakpoint
CREATE INDEX "production_sheets_assignee_due_idx" ON "production_sheets" USING btree ("assigned_user_id","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "role_assignments_single_active_global_role" ON "role_assignments" USING btree ("role") WHERE "role_assignments"."active" = true AND "role_assignments"."role" <> 'ADMIN';--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_active_idx" ON "sessions" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE INDEX "sheet_assignments_sheet_idx" ON "sheet_assignments" USING btree ("sheet_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sheet_handoffs_sequence_unique" ON "sheet_handoffs" USING btree ("sheet_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "sheet_template_versions_number_unique" ON "sheet_template_versions" USING btree ("template_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "sheet_templates_department_slug_unique" ON "sheet_templates" USING btree ("department_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_lower_unique" ON "users" USING btree (lower("username"));--> statement-breakpoint
CREATE INDEX "users_active_idx" ON "users" USING btree ("active");