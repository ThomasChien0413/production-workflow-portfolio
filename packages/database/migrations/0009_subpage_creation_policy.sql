CREATE TABLE "department_subpage_identity_permissions" (
  "subpage_id" uuid NOT NULL REFERENCES "public"."department_subpages"("id") ON DELETE cascade,
  "kind" "department_membership_kind" NOT NULL,
  "can_view" boolean DEFAULT false NOT NULL,
  "can_create" boolean DEFAULT false NOT NULL,
  "can_edit" boolean DEFAULT false NOT NULL,
  "can_submit" boolean DEFAULT false NOT NULL,
  "updated_by_user_id" uuid REFERENCES "public"."users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "department_subpage_identity_permissions_pk" PRIMARY KEY("subpage_id","kind"),
  CONSTRAINT "department_subpage_identity_kind_check" CHECK ("kind" IN ('ORDER_TAKER', 'STAFF')),
  CONSTRAINT "department_subpage_identity_view_dependency" CHECK ("can_view" OR (NOT "can_create" AND NOT "can_edit" AND NOT "can_submit"))
);--> statement-breakpoint

CREATE TABLE "department_subpage_templates" (
  "subpage_id" uuid NOT NULL REFERENCES "public"."department_subpages"("id") ON DELETE cascade,
  "template_id" uuid NOT NULL REFERENCES "public"."sheet_templates"("id") ON DELETE restrict,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "department_subpage_templates_pk" PRIMARY KEY("subpage_id","template_id")
);--> statement-breakpoint
CREATE INDEX "department_subpage_templates_template_idx" ON "department_subpage_templates" USING btree ("template_id","subpage_id");--> statement-breakpoint

-- Backfill only subpages present before this migration. Newly created subpages
-- start with no templates, and old per-user grants do not become group grants.
INSERT INTO "department_subpage_templates" ("subpage_id", "template_id")
SELECT subpage."id", template."id"
FROM "department_subpages" AS subpage
JOIN "departments" AS department ON department."id" = subpage."department_id"
JOIN "sheet_templates" AS template ON template."active" = true
JOIN "sheet_template_versions" AS version
  ON version."template_id" = template."id"
 AND version."version" = template."current_version_number"
WHERE version."published_at" IS NOT NULL
  AND (version."definition"->'allowedCreatorDepartmentCodes') ? department."code";--> statement-breakpoint
