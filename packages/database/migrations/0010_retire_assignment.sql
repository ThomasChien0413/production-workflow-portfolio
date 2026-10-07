-- Work is no longer assigned to a person (the user, 2026-09-30): a subpage's
-- identity grants decide who works on a sheet, and whoever may modify it there
-- starts it. Sheets waiting on their assignee return to 待開始 (READY); the
-- 交期 stays. Assignment rows are history and are kept, only closed.
-- The ASSIGNED enum value stays, because removing an enum value would rewrite
-- the type under every applied migration.
UPDATE "production_sheets" SET "state" = 'READY' WHERE "state" = 'ASSIGNED';--> statement-breakpoint
UPDATE "sheet_assignments" SET "ended_at" = now() WHERE "ended_at" IS NULL;
