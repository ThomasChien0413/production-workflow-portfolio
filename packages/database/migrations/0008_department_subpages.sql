CREATE TABLE "department_subpages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "department_id" uuid NOT NULL,
  "name" varchar(80) NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "created_by_user_id" uuid,
  "updated_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "department_subpages_name_check" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "department_subpages_position_check" CHECK ("position" >= 0),
  CONSTRAINT "department_subpages_revision_check" CHECK ("revision" > 0)
);--> statement-breakpoint
ALTER TABLE "department_subpages" ADD CONSTRAINT "department_subpages_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "department_subpages" ADD CONSTRAINT "department_subpages_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "department_subpages" ADD CONSTRAINT "department_subpages_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null;--> statement-breakpoint
CREATE UNIQUE INDEX "department_subpages_department_name_unique" ON "department_subpages" USING btree ("department_id",lower(btrim("name")));--> statement-breakpoint
CREATE INDEX "department_subpages_department_position_idx" ON "department_subpages" USING btree ("department_id","position","id");--> statement-breakpoint

CREATE TABLE "department_subpage_permissions" (
  "subpage_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "can_view" boolean DEFAULT false NOT NULL,
  "can_create" boolean DEFAULT false NOT NULL,
  "can_edit" boolean DEFAULT false NOT NULL,
  "can_submit" boolean DEFAULT false NOT NULL,
  "updated_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "department_subpage_permissions_subpage_id_user_id_pk" PRIMARY KEY("subpage_id","user_id"),
  CONSTRAINT "department_subpage_permissions_view_dependency" CHECK ("can_view" OR (NOT "can_create" AND NOT "can_edit" AND NOT "can_submit"))
);--> statement-breakpoint
ALTER TABLE "department_subpage_permissions" ADD CONSTRAINT "department_subpage_permissions_subpage_id_department_subpages_id_fk" FOREIGN KEY ("subpage_id") REFERENCES "public"."department_subpages"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "department_subpage_permissions" ADD CONSTRAINT "department_subpage_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "department_subpage_permissions" ADD CONSTRAINT "department_subpage_permissions_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null;--> statement-breakpoint
CREATE INDEX "department_subpage_permissions_user_idx" ON "department_subpage_permissions" USING btree ("user_id","subpage_id");--> statement-breakpoint

CREATE TABLE "department_subpage_mutations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "actor_user_id" uuid NOT NULL,
  "client_mutation_id" uuid NOT NULL,
  "action" varchar(32) NOT NULL,
  "department_id" uuid NOT NULL,
  "subpage_id" uuid,
  "result" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "department_subpage_mutations" ADD CONSTRAINT "department_subpage_mutations_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "department_subpage_mutations" ADD CONSTRAINT "department_subpage_mutations_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "department_subpage_mutations_actor_key_unique" ON "department_subpage_mutations" USING btree ("actor_user_id","client_mutation_id");--> statement-breakpoint
CREATE INDEX "department_subpage_mutations_department_idx" ON "department_subpage_mutations" USING btree ("department_id");--> statement-breakpoint

ALTER TABLE "production_sheets" ADD COLUMN "subpage_id" uuid;--> statement-breakpoint
ALTER TABLE "production_sheets" ADD CONSTRAINT "production_sheets_subpage_id_department_subpages_id_fk" FOREIGN KEY ("subpage_id") REFERENCES "public"."department_subpages"("id") ON DELETE restrict;--> statement-breakpoint
CREATE INDEX "production_sheets_subpage_state_idx" ON "production_sheets" USING btree ("subpage_id","state");--> statement-breakpoint

CREATE TABLE "sheet_subpage_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sheet_id" uuid NOT NULL,
  "actor_user_id" uuid,
  "from_department_id" uuid,
  "from_department_name" varchar(64),
  "from_subpage_id" uuid,
  "from_subpage_name" varchar(80),
  "to_department_id" uuid,
  "to_department_name" varchar(64),
  "to_subpage_id" uuid,
  "to_subpage_name" varchar(80),
  "reason" varchar(32) NOT NULL,
  "request_id" varchar(128),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "sheet_subpage_history" ADD CONSTRAINT "sheet_subpage_history_sheet_id_production_sheets_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."production_sheets"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "sheet_subpage_history" ADD CONSTRAINT "sheet_subpage_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "sheet_subpage_history" ADD CONSTRAINT "sheet_subpage_history_from_department_id_departments_id_fk" FOREIGN KEY ("from_department_id") REFERENCES "public"."departments"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "sheet_subpage_history" ADD CONSTRAINT "sheet_subpage_history_to_department_id_departments_id_fk" FOREIGN KEY ("to_department_id") REFERENCES "public"."departments"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "sheet_subpage_history" ADD CONSTRAINT "sheet_subpage_history_from_subpage_id_department_subpages_id_fk" FOREIGN KEY ("from_subpage_id") REFERENCES "public"."department_subpages"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "sheet_subpage_history" ADD CONSTRAINT "sheet_subpage_history_to_subpage_id_department_subpages_id_fk" FOREIGN KEY ("to_subpage_id") REFERENCES "public"."department_subpages"("id") ON DELETE set null;--> statement-breakpoint
CREATE INDEX "sheet_subpage_history_sheet_created_idx" ON "sheet_subpage_history" USING btree ("sheet_id","created_at");--> statement-breakpoint

INSERT INTO "department_subpages" ("department_id", "name", "position", "revision")
SELECT "id", '未分類', 0, 1 FROM "departments";--> statement-breakpoint
UPDATE "production_sheets" AS sheet
SET "subpage_id" = subpage."id"
FROM "department_subpages" AS subpage
WHERE subpage."department_id" = sheet."current_department_id" AND subpage."name" = '未分類';--> statement-breakpoint
INSERT INTO "sheet_subpage_history" (
  "sheet_id", "to_department_id", "to_department_name", "to_subpage_id", "to_subpage_name", "reason"
)
SELECT sheet."id", department."id", department."display_name", subpage."id", subpage."name", 'MIGRATION'
FROM "production_sheets" AS sheet
JOIN "departments" AS department ON department."id" = sheet."current_department_id"
JOIN "department_subpages" AS subpage ON subpage."id" = sheet."subpage_id";--> statement-breakpoint
