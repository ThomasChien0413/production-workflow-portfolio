-- Sheets no longer have a draft or a review (the user, 2026-09-30): a sheet
-- starts at 待生產 (READY) and its status is set by hand to 待生產, 生產中 or
-- 已完成. Sheets still in 草稿, 已退回 or a review stage move to 待生產;
-- one whose workflow leads to another department and that has never been sent
-- there still offers 送交 in the department that wrote it.
-- A review run left open can no longer finish, so it is closed as INVALIDATED;
-- its steps and every decided run stay as history. The enum values stay,
-- because removing one would rewrite the type under every applied migration.
UPDATE "production_sheets" SET "state" = 'READY'
WHERE "state" IN ('DRAFT', 'RETURNED', 'PENDING_SALES', 'PENDING_ASSOCIATE', 'PENDING_GENERAL_MANAGER');--> statement-breakpoint
UPDATE "approval_runs" SET "status" = 'INVALIDATED' WHERE "status" = 'PENDING';
