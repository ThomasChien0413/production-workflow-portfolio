-- Rows the receiving department ticks off on screen (the user, 2026-10-03):
-- 分條申請單's rows, by 分條's 主管, once the sheet is in 分條 with its review
-- done. One row per ticked row; unticking deletes it. Not part of the sheet's
-- values, which are the paper form's, and not printed.
CREATE TABLE "sheet_row_marks" (
  "sheet_id" uuid NOT NULL REFERENCES "production_sheets"("id") ON DELETE CASCADE,
  "section_key" varchar(64) NOT NULL,
  "row_index" integer NOT NULL,
  "marked_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "marked_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sheet_row_marks_sheet_id_section_key_row_index_pk" PRIMARY KEY ("sheet_id", "section_key", "row_index"),
  CONSTRAINT "sheet_row_marks_row_index_check" CHECK ("row_index" >= 0)
);
