UPDATE "sheet_template_versions" AS "version"
SET "definition" = "version"."definition" - 'printLayout' - 'headerLayout'
FROM "sheet_templates" AS "template"
WHERE "version"."template_id" = "template"."id"
  AND "version"."version" = 1
  AND "template"."slug" IN ('slitting-request', 'slitting-production-order')
  AND (
    "version"."definition" ? 'printLayout'
    OR "version"."definition" ? 'headerLayout'
  );
