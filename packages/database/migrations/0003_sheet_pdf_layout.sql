UPDATE "sheet_template_versions"
SET "definition" = jsonb_set(
  "definition",
  '{printLayout}',
  CASE "definition"->>'templateKey'
    WHEN 'slitting-knife-layout' THEN '{"paperSize":"A4","orientation":"PORTRAIT","marginMm":8}'::jsonb
    WHEN 'slitting-request' THEN '{"paperSize":"A4","orientation":"LANDSCAPE","marginMm":8}'::jsonb
    WHEN 'slitting-production-order' THEN '{"paperSize":"A4","orientation":"LANDSCAPE","marginMm":8}'::jsonb
    ELSE '{"paperSize":"A4","orientation":"LANDSCAPE","marginMm":8}'::jsonb
  END,
  true
)
WHERE NOT ("definition" ? 'printLayout');
