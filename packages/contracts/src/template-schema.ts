import { z } from "zod";
import {
  departmentCodeSchema,
  membershipKindSchema,
  roleCodeSchema,
} from "./roles.js";
import { sheetStateSchema } from "./sheets.js";

/**
 * Who may edit a field.
 *
 * `ORIGIN_STAFF` exists because 分條製令單 is created and filled by the
 * department's own 員工, which the user confirmed on 2026-08-08. That is a
 * deliberate departure from the default in `AGENTS.md` §5 and applies only to
 * templates that opt in through `allowedCreatorKinds`.
 */
const editableBySchema = z.enum([
  "ORIGIN_MANAGER",
  "ORIGIN_ORDER_TAKER",
  "ORIGIN_STAFF",
]);

export const templateFieldDefinitionSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-zA-Z0-9]*$/).max(64),
    // Required of every field except a spacer, which prints nothing; the
    // refinement below is what keeps that exception narrow.
    label: z.string().trim().max(80),
    type: z.enum(["DATE", "TEXT"]),
    required: z.boolean().nullable(),
    reviewed: z.boolean(),
    editableBy: z.array(editableBySchema).min(1),
    editableStates: z.array(sheetStateSchema).min(1),
    validationStatus: z.enum(["CONFIRMED", "PENDING_CONFIRMATION"]),
    /**
     * The printed cell takes more than one line. 材料寬度 and 材料材質 on
     * 分條製令單 are single cells that hold one value per coil when they
     * differ, written one under another — confirmed by the user on 2026-08-11.
     * Defaults to false so every definition published before this parses
     * unchanged.
     */
    multiline: z.boolean().default(false),
    /**
     * How many written lines a multi-line cell holds, where the paper fixes
     * it: 士電's 品名 is one cell written on two lines (the user, 2026-10-02).
     * The box opens that tall. Needs `multiline`.
     */
    lines: z.number().int().min(2).max(6).optional(),
    /**
     * The printed cell *is* a value the system already tracks, rather than one
     * more transcribed string.
     *
     * `DUE_AT` binds it to the sheet's deadline, which drives the 已逾期 queue
     * and the daily 09:00 reminder. 裁剪需求表 prints 交期 because the customer
     * sets it when the order is taken, and the user asked on 2026-08-15 for
     * that date to be the system's — so a cutting job counts as late against
     * the date the customer was given, not against a deadline invented later
     * at assignment.
     *
     * Omitted on every other field, which keeps them plain stored values.
     */
    bindsTo: z.enum(["DUE_AT"]).optional(),
    /**
     * The cell holds printed text, not a box anyone writes in.
     *
     * 加工製令單 prints `KG` in its own ruled cell after 預重單重, and
     * `製令單交給生產部` in one beside 工單號. They are cells of the form, so
     * they are cells here — the label is reproduced exactly as printed and no
     * write-on box is invented after it. Defaults to false, so every field
     * transcribed before this stays a box.
     */
    printedOnly: z.boolean().default(false),
    /**
     * A unit printed inside the write-on cell itself.
     *
     * Two papers do this differently and the difference is visible, so both
     * are recorded rather than flattened. 裁剪需求表 rules one cell for
     * 變壓器容量 and prints `KVA` in it — the row below rules the same column
     * empty, so that cell is the box and the operator writes the number beside
     * the unit. 加工製令單 instead rules a separate cell for `KG` after the
     * box, which is `printedOnly` above.
     */
    unit: z.string().trim().min(1).max(16).optional(),
    /**
     * The cell is ruled corner to corner, as CUT's date columns are.
     * The line is how the paper splits one cell into two writing halves —
     * month above it, day below — so it is printed, not decoration, and the
     * reproduction draws it. The cell still takes one value: the split is a
     * writing aid on paper, and typing 9/15 into one box says the same thing.
     */
    diagonalSplit: z.boolean().default(false),
    /**
     * Cell shading, as the worksheet fills it.
     *
     * 大銀.直得 greys its heading row and fills 單價 solid yellow down the
     * page; 士電 greys the two headings of its weight block. These are on the
     * controlled form rather than marks someone added, so they are reproduced.
     * Recorded as the worksheet's own colours rather than mapped to the
     * design system: the point is to match the paper, not to look native.
     */
    headingFill: z
      .string()
      .regex(/^#[0-9a-f]{6}$/)
      .optional(),
    cellFill: z
      .string()
      .regex(/^#[0-9a-f]{6}$/)
      .optional(),
    /**
     * A heading the worksheet sets smaller than the rest to fit its column:
     * 燒炖質量記錄表 prints 裝箱日/時間 at 12pt beside 14pt headings, so it
     * breaks after the slash rather than inside 裝箱日.
     */
    headingSmall: z.boolean().optional(),
    /**
     * A gap the worksheet rules as a real but empty column.
     *
     * 士電 prints its weight block outside the ruled form, separated by a
     * narrow unruled column. Reproducing that as one table with a spacer
     * column — rather than two tables side by side — is what the worksheet
     * itself does, and it keeps the two halves' rows aligned by construction.
     * A spacer carries no heading, no box and no value.
     */
    spacer: z.boolean().default(false),
    /**
     * A cell the paper computes rather than asks anyone to write.
     *
     * 士電's 總重 is =ROUNDUP(數量 * 單顆重量, 0) on every row. A derived value
     * is never stored: storing it would let it drift from the factors it is
     * derived from, so it is recomputed wherever the row is shown.
     */
    computed: z
      .object({
        kind: z.literal("PRODUCT_ROUNDED_UP"),
        factors: z.array(z.string().min(1).max(64)).length(2),
      })
      .strict()
      .optional(),
    /**
     * Printed boxes to tick, one of which is the value.
     *
     * CUT成品檢查表 prints 判定 as `□OK □NG`: the inspector ticks one. The
     * stored value is the ticked label, or empty while neither is. Only a
     * header field may carry them — see the definition's refinement.
     */
    choices: z
      .array(z.string().trim().min(1).max(16))
      .min(2)
      .max(6)
      .refine((choices) => new Set(choices).size === choices.length, {
        message: "choices must be unique",
      })
      .optional(),
    /**
     * What the paper prints between boxes to tick: 信太's 特性檢驗報告單 sets
     * `□合格 / □不合格`. Omitted means a space, as `□OK □NG`.
     */
    choicesSeparator: z.string().max(4).optional(),
    /**
     * The one box to tick that is followed by a line to write on: 沖壓's
     * 產品需求表 prints 交期 as `□庫存□其他：＿＿`. The value is still one
     * string — the ticked label, or `其他：` and what was written after it —
     * so every existing reader of a ticked value keeps working. Must be one of
     * `choices`.
     */
    choiceWriteIn: z.string().trim().min(1).max(16).optional(),
    /**
     * How the write-in box is printed before and after its line. 產品需求表
     * sets `□其他：＿＿`, the default colon; 沖壓's 生產日報表 sets
     * `□請假 ＿H`, a space before the hours and the H after. Printing only:
     * the stored value is `請假：4` either way.
     */
    choiceWriteInSeparator: z.string().max(2).optional(),
    choiceWriteInUnit: z.string().trim().min(1).max(4).optional(),
    /**
     * This column and the next share one printed cell of a register. 沖壓's
     * 生產日報表 writes `E: ＿K* ＿箱` in one cell — the weight and the count
     * side by side (`INLINE`) — and `E: ＿K` over `I: ＿K` in another
     * (`STACKED`). Each part is its own stored value; only the printing is
     * shared, so history, conflicts and permissions stay per value.
     *
     * In a FIELDS band (`INLINE` only), the next field is written in this
     * field's box, under this field's label, and prints no label of its own:
     * 退火明細表's 程式編號 is `＿ 第 ＿ 程式 ＿`, three values in one box (the
     * user, 2026-10-02). A joined field's label names it for a screen reader
     * and in history.
     */
    joinNext: z.enum(["INLINE", "STACKED"]).optional(),
    /**
     * Printed text before the write-on value, inside its cell — 信太 prints
     * 客戶單號 as `B___`, the order number written after the B. The mirror
     * of `unit`.
     */
    prefix: z.string().trim().min(1).max(16).optional(),
    /**
     * The worksheet columns this field's label and box take, in a FIELDS
     * section that sets a `fieldGrid`. A printed-only cell has no box, so its
     * `value` is 0.
     */
    gridSpan: z
      .object({
        label: z.number().int().min(1).max(24),
        value: z.number().int().min(0).max(24),
      })
      .strict()
      .optional(),
    /** The label's printed colour, where the paper sets it apart in red. */
    labelColor: z
      .string()
      .regex(/^#[0-9a-f]{6}$/)
      .optional(),
    /**
     * The name a screen reader gives the box, when the printed label alone
     * says nothing: 信太 prints its second 電壓 as just `/`.
     */
    accessibleLabel: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

const fieldsSectionSchema = z
  .object({
    type: z.literal("FIELDS"),
    key: z.string().min(1).max(64),
    fields: z.array(templateFieldDefinitionSchema).min(1),
    /**
     * How many fields sit on each printed row, e.g. `[3, 4, 4]` for the header
     * of 裁剪需求表.
     *
     * Omitted means one row, which is every form transcribed before this
     * existed and is right for the three or four fields those print. Eleven on
     * one row is not a header, it is a row of vertical labels one character
     * wide — the paper wraps, so the definition has to be able to say where.
     * Rows that name their own break also size their cells to their contents
     * rather than splitting the width evenly, because the paper gives 客戶名稱
     * more room than 台數.
     */
    fieldRows: z.array(z.number().int().min(1).max(12)).min(1).max(12).optional(),
    /**
     * The worksheet's own columns under a wrapped header, as relative widths
     * (the source's column widths), e.g. the ten columns of 加工製令單.
     *
     * With it, every printed row sits on the same columns and each field says
     * how many it takes (`gridSpan`), so labels and boxes line up from row to
     * row as they do on the paper — 客戶, 鐵芯尺寸, 材質, 鋼捲號, 備註 and
     * 退火編號 down one edge (the user, 2026-10-02). Without it, each row sizes
     * to its own words, which is right for headers whose rows the paper does
     * not align.
     */
    fieldGrid: z.array(z.number().positive().max(100)).min(2).max(24).optional(),
    /**
     * A drawing in the grid's last `columns` columns, from printed row
     * `startRow` to the band's end, beside the fields: 特性檢驗報告單 draws
     * its A–D views to the right of 出貨數量, 抽樣數量 and 檢驗者, and 信太
     * beside 檢驗者 and 備註 (the user, 2026-10-02). Needs a `fieldGrid`;
     * those rows fill the other columns.
     */
    asideDrawing: z
      .object({
        asset: z.string().regex(/^\/[A-Za-z0-9/_-]+\.(png|jpe?g|svg)$/),
        alt: z.string().trim().min(1).max(300),
        columns: z.number().int().min(1).max(23),
        startRow: z.number().int().min(1).max(12).default(1),
      })
      .strict()
      .optional(),
  })
  .strict();

/**
 * How `required` applies to a printed form with a fixed number of rows.
 *
 * `COMPLETE_IF_STARTED` is the sensible reading of "the row fields are
 * required": a row may be left entirely blank, but a row the user has started
 * must be finished. Requiring every cell of every row would force a manager
 * with three line items to invent five more.
 */
const rowRequirementSchema = z.enum(["COMPLETE_IF_STARTED", "ALL_ROWS"]);

/**
 * Checks that apply to a field wherever one is used.
 *
 * They live here rather than on templateFieldDefinitionSchema because
 * matrixRowSchema extends that schema, and zod 4 refuses to extend an object
 * that carries refinements.
 */
function checkFieldShape(
  field: z.infer<typeof templateFieldDefinitionSchema>,
  context: z.RefinementCtx,
  path: (string | number)[],
) {
  if (field.label.length === 0 && !field.spacer) {
    context.addIssue({
      code: "custom",
      path: [...path, "label"],
      message: "only a spacer may carry no label",
    });
  }
  // A spacer is a gap: nothing is printed in it and nothing is worked out for
  // it, so it can be neither computed nor a printed-text cell.
  if (field.spacer && (field.computed || field.printedOnly)) {
    context.addIssue({
      code: "custom",
      path: [...path, "spacer"],
      message: "a spacer carries no value, computed or printed",
    });
  }
}

const fixedRowsSectionSchema = z
  .object({
    type: z.literal("FIXED_ROWS"),
    key: z.string().min(1).max(64),
    label: z.string().trim().min(1).max(80),
    /**
     * Whether the form prints a row-number column at all.
     *
     * Every form transcribed before EI客戶訂購表 numbers its rows — 序, 項目 —
     * so this defaults to true and nothing already published changes. That
     * form does not: its first column is 訂日, and a number column invented
     * for the screen would be a column the operator cannot find on the paper
     * in front of them.
     */
    rowNumbers: z.boolean().default(true),
    /** Visible heading above the printed row numbers, e.g. 序. */
    rowNumberLabel: z.string().trim().max(16).default(""),
    /**
     * Relative widths transcribed from the source document. They stay unitless
     * so the browser can preserve the proportions inside a responsive scroll
     * region without pretending Excel character widths are CSS pixels.
     */
    rowNumberWidthUnits: z.number().positive().optional(),
    columnWidthUnits: z.array(z.number().positive()).optional(),
    rowCount: z.number().int().min(1).max(100),
    rowRequirement: rowRequirementSchema,
    /** Sheets cannot be submitted with fewer completed rows than this. */
    minimumCompletedRows: z.number().int().min(0).max(100),
    columns: z.array(templateFieldDefinitionSchema).min(1),
    /**
     * A ruled line of printed text closing the register, beneath its rows.
     *
     * 生產作業看板 prints what each 工序 code means — 捲繞 = (1) through
     * 包裝 = (9) — in a cell spanning every column, inside the form's box. It
     * is part of the form, never filled in, so it is carried here rather than
     * as a field nobody can write in or a section of its own.
     */
    legend: z.string().trim().min(1).max(200).optional(),
    /**
     * Which side of its band the legend sits on.
     *
     * 生產作業看板 sets its legend right- and bottom-aligned; 個人生產日報表
     * starts its 工作代號 key at the left, on two lines. Omitted means the
     * board's setting, so the board's published definition parses unchanged.
     */
    legendAlign: z.enum(["START", "END"]).optional(),
    /**
     * Rows printed in equal blocks, each with one cell running down its side.
     *
     * 生產日報表 gives each person eight rows and writes their name once, in a
     * cell spanning all eight; a heavier rule separates one person from the
     * next, and their number, 1 to 8, is printed outside the box. The spanning
     * cell is the section's first column: it is stored on each block's first
     * row, and the same column on the block's other rows is never shown and
     * never accepted, so a name cannot be written where nobody can see it.
     *
     * `perPage` is how many blocks the paper puts on one sheet: 生產日報表
     * prints people 1–4 on one and 5–8 on the next, and the printed document
     * breaks there rather than splitting someone's rows across two pages.
     */
    /**
     * A ruled line of printed text heading the register, above its column
     * headings and inside its box — CUT成品檢查表 prints `外觀尺寸` there,
     * with `單位: mm` set to its right.
     */
    caption: z
      .object({
        text: z.string().trim().min(1).max(40),
        note: z.string().trim().min(1).max(40).optional(),
      })
      .strict()
      .optional(),
    /**
     * The first row's first cell, ruled corner to corner and printed rather
     * than written in: `across` names what the rest of that row holds and
     * `down` what the rest of the first column holds.
     *
     * CUT成品檢查表 prints 尺寸 over the diagonal and 序號 under it: the first
     * row takes the nominal size of each dimension, and each row below it one
     * measured piece, numbered in the first column. The cell is not a field.
     */
    cornerCell: z
      .object({
        across: z.string().trim().min(1).max(16),
        down: z.string().trim().min(1).max(16),
      })
      .strict()
      .optional(),
    /**
     * The register's first row is its standard, printed directly under the
     * column headings, with a diagonal corner cell running down the lead
     * column beside both.
     *
     * 特性檢驗報告單 prints 標準值 over 測試值 in that corner, and the standard
     * is written under each heading's letter in the same tall cell — so
     * `ruled` is false and no line divides them. 崧貿's copy prints 位置 over
     * 標準值 and rules the standard row off as a row of its own. Either way
     * the rows below are the tests, numbered from 1. The lead column is the
     * row-number column when there is one; otherwise it is the first column,
     * whose first cell the corner covers.
     */
    standardRow: z
      .object({
        label: z.string().trim().min(1).max(16),
        corner: z
          .object({
            across: z.string().trim().min(1).max(16),
            down: z.string().trim().min(1).max(16),
          })
          .strict(),
        ruled: z.boolean(),
      })
      .strict()
      .optional(),
    /**
     * Rows printed in side-by-side blocks rather than one long column:
     * 巧力's 出廠檢驗單 prints 序 1–5 beside 6–10, each block with its own
     * headings, separated by a gap `gapUnits` wide.
     */
    blocks: z
      .object({
        count: z.number().int().min(2).max(4),
        gapUnits: z.number().positive().optional(),
      })
      .strict()
      .optional(),
    rowGroups: z
      .object({
        size: z.number().int().min(2).max(20),
        spanningColumnKey: z.string().regex(/^[a-z][a-zA-Z0-9]*$/).max(64),
        numbered: z.boolean(),
        /** Relative width of the number printed outside the box. */
        numberWidthUnits: z.number().positive().optional(),
        perPage: z.number().int().min(1).max(20).optional(),
      })
      .strict()
      .optional(),
    /**
     * Headings printed on two rows, one spanning several cells above theirs.
     *
     * 沖壓's 生產日報表 prints 不良品 over C級, D級 and 報廢 (`subheadings`
     * true), and 箱重/箱數 across its E and I cells with nothing under it
     * (`subheadings` false: one tall heading over both). `columnKeys` lists
     * every column the heading covers, in order; it must begin and end on
     * whole printed cells. Every other heading runs down both rows.
     */
    headingGroups: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(40),
            columnKeys: z.array(z.string().regex(/^[a-z][a-zA-Z0-9]*$/).max(64)).min(1),
            subheadings: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .optional(),
  })
  .strict()
  .superRefine((section, context) => {
    section.columns.forEach((column, index) => {
      checkFieldShape(column, context, ["columns", index]);
    });
    // Shared cells hold plain write-on boxes, in a plain register: every
    // other printed structure assumes one value per cell.
    const joins = section.columns.some((column) => column.joinNext);
    section.columns.forEach((column, index) => {
      if (!column.joinNext) return;
      const next = section.columns[index + 1];
      const parts = [column, next];
      if (
        !next ||
        parts.some(
          (part) =>
            !part ||
            part.spacer ||
            part.computed ||
            part.printedOnly ||
            part.choices ||
            part.diagonalSplit,
        ) ||
        (next.joinNext !== undefined && next.joinNext !== column.joinNext)
      ) {
        context.addIssue({
          code: "custom",
          path: ["columns", index, "joinNext"],
          message: "a shared cell joins plain write-on columns, laid out one way",
        });
      }
    });
    if (
      (joins || section.headingGroups) &&
      (section.standardRow || section.cornerCell || section.rowGroups || section.blocks || section.caption)
    ) {
      context.addIssue({
        code: "custom",
        path: [joins ? "columns" : "headingGroups"],
        message: "shared cells and heading groups need a plain register",
      });
    }
    if (section.headingGroups) {
      const cells = printedCells(section);
      const starts = new Map(cells.map((cell, index) => [cell.columns[0]!.key, index]));
      const ends = new Map(cells.map((cell, index) => [cell.columns.at(-1)!.key, index]));
      const order = section.columns.map((column) => column.key);
      const claimed = new Set<string>();
      section.headingGroups.forEach((group, groupIndex) => {
        const first = order.indexOf(group.columnKeys[0]!);
        const contiguous =
          first >= 0 &&
          group.columnKeys.every((key, offset) => order[first + offset] === key);
        const whole =
          starts.has(group.columnKeys[0]!) && ends.has(group.columnKeys.at(-1)!);
        const overlaps = group.columnKeys.some((key) => claimed.has(key));
        group.columnKeys.forEach((key) => claimed.add(key));
        if (!contiguous || !whole || overlaps) {
          context.addIssue({
            code: "custom",
            path: ["headingGroups", groupIndex, "columnKeys"],
            message: "a heading group covers adjacent whole printed cells, once",
          });
        }
      });
    }
    const groups = section.rowGroups;
    if (groups) {
      if (section.rowCount % groups.size !== 0) {
        context.addIssue({
          code: "custom",
          path: ["rowGroups", "size"],
          message: "rowCount must be a whole number of row groups",
        });
      }
      // The spanning cell leads each block, so it has to be the first column;
      // a block's own numbering replaces per-row numbers.
      const first = section.columns[0];
      if (
        !first ||
        first.key !== groups.spanningColumnKey ||
        first.spacer ||
        first.computed ||
        first.printedOnly
      ) {
        context.addIssue({
          code: "custom",
          path: ["rowGroups", "spanningColumnKey"],
          message: "the spanning column must be the first, write-on column",
        });
      }
      if (section.rowNumbers) {
        context.addIssue({
          code: "custom",
          path: ["rowNumbers"],
          message: "row groups print their own numbers, not one per row",
        });
      }
      if (
        groups.numberWidthUnits !== undefined &&
        (!groups.numbered || section.columnWidthUnits === undefined)
      ) {
        context.addIssue({
          code: "custom",
          path: ["rowGroups", "numberWidthUnits"],
          message: "a number width needs numbered groups and column widths",
        });
      }
      if (
        groups.perPage !== undefined &&
        groups.perPage >= section.rowCount / groups.size
      ) {
        context.addIssue({
          code: "custom",
          path: ["rowGroups", "perPage"],
          message: "perPage must leave more than one page of groups",
        });
      }
    }
    if (section.cornerCell) {
      const first = section.columns[0];
      if (!first || first.spacer || first.computed || first.printedOnly) {
        context.addIssue({
          code: "custom",
          path: ["cornerCell"],
          message: "a corner cell needs a write-on first column below it",
        });
      }
    }
    // A standard row, a corner cell, row groups and side-by-side blocks each
    // reshape the first rows or the lead column; no paper combines them.
    const shapers = [
      section.standardRow && "standardRow",
      section.cornerCell && "cornerCell",
      section.rowGroups && "rowGroups",
      section.blocks && "blocks",
    ].filter(Boolean);
    if (shapers.length > 1) {
      context.addIssue({
        code: "custom",
        path: [String(shapers[1])],
        message: `${shapers.join(" and ")} cannot be combined`,
      });
    }
    if (section.standardRow) {
      if (section.rowCount < 2) {
        context.addIssue({
          code: "custom",
          path: ["rowCount"],
          message: "a standard row needs rows to test below it",
        });
      }
      const first = section.columns[0];
      if (
        !section.rowNumbers &&
        (!first || first.spacer || first.computed || first.printedOnly)
      ) {
        context.addIssue({
          code: "custom",
          path: ["standardRow"],
          message: "a standard row's corner needs a write-on first column below it",
        });
      }
    }
    if (section.blocks && section.rowCount % section.blocks.count !== 0) {
      context.addIssue({
        code: "custom",
        path: ["blocks", "count"],
        message: "rowCount must divide evenly into blocks",
      });
    }
    if (section.legendAlign !== undefined && section.legend === undefined) {
      context.addIssue({
        code: "custom",
        path: ["legendAlign"],
        message: "legendAlign needs a legend",
      });
    }
    // A computed cell works from other columns of the same row, so the
    // columns it names have to be there.
    const keys = new Set(section.columns.map((column) => column.key));
    section.columns.forEach((column, index) => {
      for (const factor of column.computed?.factors ?? []) {
        if (!keys.has(factor)) {
          context.addIssue({
            code: "custom",
            path: ["columns", index, "computed"],
            message: `computed factor ${factor} is not a column of this section`,
          });
        }
      }
    });
  })
  .refine((section) => section.minimumCompletedRows <= section.rowCount, {
    message: "minimumCompletedRows cannot exceed rowCount",
    path: ["minimumCompletedRows"],
  })
  .refine(
    // One width per printed cell: columns that share a cell share its width.
    (section) =>
      section.columnWidthUnits === undefined ||
      section.columnWidthUnits.length === printedCells(section).length,
    {
      message: "columnWidthUnits must match the number of printed cells",
      path: ["columnWidthUnits"],
    },
  )
  .refine(
    (section) => {
      if (!section.rowNumbers) return section.rowNumberWidthUnits === undefined;
      const hasRowWidth = section.rowNumberWidthUnits !== undefined;
      const hasColumnWidths = section.columnWidthUnits !== undefined;
      return hasRowWidth === hasColumnWidths;
    },
    {
      message: "row and column width units must be supplied together",
      path: ["rowNumberWidthUnits"],
    },
  );

/**
 * A printed grid of fixed row labels against fixed column headings — for
 * example 拆包檢驗/鐵損值/開料尺寸/開料數量 recorded once per 捲, or the
 * 檢驗紀錄 block where each row also carries a printed 標準值.
 *
 * Distinct from FIXED_ROWS: there the rows are interchangeable line items the
 * user fills in freely, whereas here both axes are printed on the form and
 * neither can be added to or reordered.
 */
const matrixColumnSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-zA-Z0-9]*$/).max(64),
    label: z.string().trim().min(1).max(80),
    /**
     * A second printed line beneath the heading, in a smaller face —
     * 首件檢驗 carries 依據F/Q-08檢驗 that way. Kept separate from the label
     * so each is reproduced as printed rather than run together.
     */
    note: z.string().trim().min(1).max(80).optional(),
    /**
     * A heading printed once over this column and the next few:
     * 首件/巡迴檢驗單 prints 檢測值 across its three reading columns. The
     * columns keep their own labels for a screen reader.
     */
    heading: z.string().trim().min(1).max(40).optional(),
    headingSpan: z.number().int().min(2).max(10).optional(),
    /**
     * Every cell of this column is a box to tick, whatever its row: the
     * 判定 column of 首件檢驗, ticked ✓ or ✗ on every row. `CHOSEN` prints
     * only the ticked mark, as a hand writes it, rather than every box.
     */
    choices: z.array(z.string().trim().min(1).max(16)).min(2).max(6).optional(),
    choicesPrint: z.literal("CHOSEN").optional(),
    /**
     * Every cell of this column prints its row's `standardValue` rather
     * than taking an entry: 沖壓 and 平板剪's 首件檢驗 prints 公差 — ≦0.1,
     * ±0.1, ±1 — beside a written 標準. Nothing is stored for it.
     */
    printsStandard: z.literal(true).optional(),
  })
  .strict();

const matrixRowSchema = templateFieldDefinitionSchema.extend({
  /** Printed tolerance or expected value shown beside the row, e.g. ≦0.01. */
  standardValue: z.string().trim().max(80).nullable(),
  /**
   * Empty is allowed here, unlike every other label: 入庫檢驗 ends with a
   * printed blank line for an inspection the form did not anticipate. Naming
   * it would put words on the screen that are not on the paper.
   */
  label: z.string().trim().max(80),
  /**
   * Columns this row prints as one cell: 首件檢驗's 龜裂 row ticks 有 or 無
   * once across 標準 and the three 檢測值. The value is stored under the
   * first; the others are never shown or accepted for this row.
   */
  spanColumns: z.array(z.string().regex(/^[a-z][a-zA-Z0-9]*$/).max(64)).min(2).optional(),
  /**
   * A unit printed after the entry in the named columns: 積厚 prints `mm` in
   * its 標準 cell and in each 製程檢驗 round, and nowhere else on its row.
   */
  cellUnits: z
    .record(z.string().regex(/^[a-z][a-zA-Z0-9]*$/).max(64), z.string().trim().min(1).max(4))
    .optional(),
});

/**
 * One part of a written-in heading: 製程檢驗 writes when each round was
 * checked as `＿日 ＿時 ＿分` in the round's own heading.
 */
const headingEntryPartSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-zA-Z0-9]*$/).max(64),
    unit: z.string().trim().min(1).max(4),
  })
  .strict();

/** A matrix row as a definition writes it, before parsing fills defaults. */
export type MatrixRowInput = z.input<typeof matrixRowSchema>;

const matrixGroupSchema = z
  .object({
    key: z.string().min(1).max(64),
    /** Printed group label such as 首件檢驗; null when the block is unlabelled. */
    label: z.string().trim().min(1).max(80).nullable(),
    rows: z.array(matrixRowSchema).min(1),
    /**
     * Printed above the column headings rather than under them: 沖壓 and
     * 平板剪's 製程檢驗 writes each round's 製令單號 and 規格 before the
     * 檢驗時間 row. Only the printed layout draws it there.
     */
    aboveHeading: z.literal(true).optional(),
  })
  .strict();

const matrixSectionSchema = z
  .object({
    type: z.literal("MATRIX"),
    key: z.string().min(1).max(64),
    label: z.string().trim().min(1).max(80),
    /**
     * The heading printed over the row-label column, when it differs from the
     * block heading. 檢驗紀錄 heads the recorded values while the rows
     * themselves are headed 檢驗項目, which the document prints as two header
     * rows. Omitted means one header row with `label` over the row labels.
     */
    rowLabelHeading: z.string().trim().min(1).max(80).optional(),
    /** Heading printed over the group column, e.g. 序. */
    groupHeading: z.string().trim().min(1).max(80).optional(),
    columns: z.array(matrixColumnSchema).min(1).max(40),
    /**
     * Relative widths for the row-label column and then each data column,
     * transcribed from the source. Unitless, like the FIXED_ROWS pair, so a
     * browser can hold the source proportions without pretending Excel
     * character widths are CSS pixels. Omitted means an even split, which is
     * what every matrix transcribed before 加工製令單 was drawn with.
     */
    columnWidthUnits: z.array(z.number().positive()).optional(),
    groups: z.array(matrixGroupSchema).min(1),
    /**
     * Text printed down the left of the whole block, headings included:
     * 首件/巡迴檢驗單 labels its two blocks 首件檢驗 and 製程檢驗.
     */
    sideLabel: z.string().trim().min(1).max(16).optional(),
    /**
     * One corner over the group and row-label columns, ruled corner to
     * corner: 製程檢驗 prints 檢驗時間 over the line and 品質特性 under it.
     */
    cornerCell: z
      .object({
        across: z.string().trim().min(1).max(16),
        down: z.string().trim().min(1).max(16),
      })
      .strict()
      .optional(),
    /**
     * Each column's heading is written in rather than printed: 製程檢驗's
     * rounds are headed with when they were checked, `＿日 ＿時 ＿分`.
     * `field` carries the name and edit rules; each part is its own value.
     */
    headingEntry: z
      .object({
        field: templateFieldDefinitionSchema,
        parts: z.array(headingEntryPartSchema).min(1).max(4),
      })
      .strict()
      .optional(),
    /**
     * A block printed to the right of the rows, down the block's full
     * height: 首件檢驗's core drawings, with 類型 ticked C型 or 環型 and the
     * note under them.
     */
    aside: z
      .object({
        field: templateFieldDefinitionSchema,
        drawing: z
          .object({
            asset: z.string().regex(/^\/[A-Za-z0-9/_-]+\.(png|jpe?g|svg)$/),
            alt: z.string().trim().min(1).max(300),
          })
          .strict(),
        note: z.string().trim().min(1).max(80).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((section, context) => {
    const keys = section.columns.map((column) => column.key);
    section.columns.forEach((column, index) => {
      if (
        (column.heading !== undefined) !== (column.headingSpan !== undefined) ||
        (column.headingSpan !== undefined && index + column.headingSpan > keys.length)
      ) {
        context.addIssue({
          code: "custom",
          path: ["columns", index, "headingSpan"],
          message: "a spanning heading names its text and a span within the columns",
        });
      }
      if (column.choicesPrint !== undefined && column.choices === undefined) {
        context.addIssue({
          code: "custom",
          path: ["columns", index, "choicesPrint"],
          message: "choicesPrint needs choices",
        });
      }
    });
    section.groups.forEach((group, groupIndex) => {
      group.rows.forEach((row, rowIndex) => {
        const span = row.spanColumns;
        if (!span) return;
        const first = keys.indexOf(span[0]!);
        const adjacent =
          first >= 0 && span.every((key, offset) => keys[first + offset] === key);
        if (!adjacent) {
          context.addIssue({
            code: "custom",
            path: ["groups", groupIndex, "rows", rowIndex, "spanColumns"],
            message: "a row spans adjacent columns",
          });
        }
      });
    });
  })
  .refine(
    (section) =>
      section.columnWidthUnits === undefined ||
      section.columnWidthUnits.length === matrixWidthSlots(section),
    {
      message: "columnWidthUnits must cover every printed column",
      path: ["columnWidthUnits"],
    },
  );

/**
 * The columns a matrix row is written in. A row printed as one cell across
 * several columns — 首件檢驗's 龜裂 across 標準 and the three 檢測值 — is
 * written in the first of them only.
 */
export function matrixWrittenColumns<Column extends { key: string; printsStandard?: true | undefined }>(
  section: { columns: Column[] },
  row: { spanColumns?: string[] | undefined },
): Column[] {
  return matrixRowCells(section, row)
    .filter((cell) => !cell.printed)
    .map((cell) => cell.column);
}

/**
 * The boxes a matrix cell ticks: its column's own, else its row's. A row
 * printed as one cell across several columns ticks only in that cell —
 * 沖壓 and 平板剪's 外觀 ticks 有 or 無 across 標準 to 檢測值 and leaves
 * its 判定 to be written — while a row that spans nothing, a 製程 round's
 * 有/無, ticks in every cell.
 */
export function matrixCellChoices(
  column: { key: string; choices?: string[] | undefined },
  row: { choices?: string[] | undefined; spanColumns?: string[] | undefined },
): string[] | undefined {
  if (column.choices) return column.choices;
  if (row.spanColumns && row.spanColumns[0] !== column.key) return undefined;
  return row.choices;
}

/**
 * The cells a matrix row prints, in order: each column not covered by a span,
 * how many columns it spans, and whether it prints the row's standard value
 * (公差) rather than taking an entry. A span that starts on a printed column
 * is written, as its first column holds the value.
 */
export function matrixRowCells<Column extends { key: string; printsStandard?: true | undefined }>(
  section: { columns: Column[] },
  row: { spanColumns?: string[] | undefined },
): { column: Column; span: number; printed: boolean }[] {
  const covered = new Set((row.spanColumns ?? []).slice(1));
  return section.columns
    .filter((column) => !covered.has(column.key))
    .map((column) => {
      const span = row.spanColumns?.[0] === column.key ? row.spanColumns.length : 1;
      return { column, span, printed: column.printsStandard === true && span === 1 };
    });
}

/**
 * Whether a matrix uses the printed layout 首件/巡迴檢驗單 introduced — a
 * side label, a corner, written-in headings or a block beside the rows. Every
 * matrix before it keeps its own rendering, untouched.
 */
export function isPrintedMatrix(section: {
  sideLabel?: string | undefined;
  cornerCell?: unknown;
  headingEntry?: unknown;
  aside?: unknown;
}): boolean {
  return (
    section.sideLabel !== undefined ||
    section.cornerCell !== undefined ||
    section.headingEntry !== undefined ||
    section.aside !== undefined
  );
}

/**
 * How many widths a matrix's `columnWidthUnits` gives. The older shape: the
 * row labels, then each column. The printed layout: the side label, the
 * group labels, the row labels, each column and the block beside them, as
 * far as the matrix prints each.
 */
export function matrixWidthSlots(section: {
  sideLabel?: string | undefined;
  cornerCell?: unknown;
  headingEntry?: unknown;
  aside?: unknown;
  columns: unknown[];
  groups: { label: string | null }[];
}): number {
  if (!isPrintedMatrix(section)) return section.columns.length + 1;
  return (
    (section.sideLabel !== undefined ? 1 : 0) +
    (section.groups.some((group) => group.label !== null) ? 1 : 0) +
    1 +
    section.columns.length +
    (section.aside !== undefined ? 1 : 0)
  );
}

/** A run of numbered cells printed across the form, e.g. 排刀情況 1–20. */
const numberedGridSectionSchema = z
  .object({
    type: z.literal("NUMBERED_GRID"),
    key: z.string().min(1).max(64),
    label: z.string().trim().min(1).max(80),
    columnCount: z.number().int().min(1).max(60),
    rowCount: z.number().int().min(1).max(20),
    /**
     * Printed column headings, when they are not plain numbers — 條料入庫 heads
     * its nine columns （1）…（9). Omitted means 1…columnCount.
     */
    columnLabels: z.array(z.string().trim().min(1).max(16)).optional(),
    /** One rule applies to every cell in the grid. */
    cell: templateFieldDefinitionSchema,
  })
  .strict()
  .refine(
    (section) =>
      section.columnLabels === undefined ||
      section.columnLabels.length === section.columnCount,
    { message: "columnLabels must match columnCount", path: ["columnLabels"] },
  );

/**
 * Numbered write-on blanks laid out in a printed grid, e.g. 領料鋼捲號 １–９
 * across three columns — with a fourth, unnumbered row for continuation.
 *
 * `count` is how many blanks carry a printed number; `columns × rows` is the
 * printed shape. Cells beyond `count` are drawn without a number, exactly as
 * the paper does.
 */
const numberedBlanksSectionSchema = z
  .object({
    type: z.literal("NUMBERED_BLANKS"),
    key: z.string().min(1).max(64),
    label: z.string().trim().min(1).max(80),
    count: z.number().int().min(1).max(60),
    columns: z.number().int().min(1).max(12).default(3),
    rows: z.number().int().min(1).max(20).default(3),
    entry: templateFieldDefinitionSchema,
    /**
     * Which way the numbers run. Omitted means across, as 分條製令單 prints
     * them; `DOWN` numbers each column top to bottom first, as 沖壓's
     * 生產日報表 prints 1–6 down its left and 7–12 down its right.
     */
    order: z.enum(["ACROSS", "DOWN"]).optional(),
    /**
     * Printed on the back of the sheet. 沖壓's 生產日報表 leaves its back
     * for the material labels torn off the coils. The screen shows it below
     * the front under 背面; the document prints it on its own portrait page,
     * as the paper does, with no caption.
     */
    printedOnBack: z.boolean().optional(),
  })
  .strict()
  .refine((section) => section.count <= section.columns * section.rows, {
    message: "count cannot exceed the printed grid",
    path: ["count"],
  });

const approvalBlockSchema = z
  .object({
    visibleLabel: z.string().trim().min(1).max(80),
    mappedTo: z.enum([
      "ORIGIN_MANAGER",
      "SALES",
      "ASSOCIATE",
      "GENERAL_MANAGER",
    ]),
    transcriptionStatus: z.enum(["CONFIRMED", "AMBIGUOUS"]),
  })
  .strict();

const approvalSectionSchema = z
  .object({
    type: z.literal("APPROVAL_STATUS"),
    key: z.string().min(1).max(64),
    blocks: z.array(approvalBlockSchema).min(1),
  })
  .strict();

/**
 * A band of printed illustrations that carry no data.
 *
 * 裁剪需求表 ends with three core-stacking drawings under 主鐵芯(一), 副鐵芯 and
 * 主鐵芯(二) — reference pictures telling the operator how the laminations go
 * together. The user asked on 2026-08-15 for them to be reproduced as printed,
 * so they are part of the form rather than something a screen invents: the
 * asset path lives in the definition, and no renderer branches on a template
 * name to decide which pictures to show.
 *
 * There are no fields here, and nothing is stored. `alt` is required because a
 * diagram with no text alternative is invisible to anyone using a screen
 * reader, and this band is the only place the stacking method is stated.
 */
const diagramsSectionSchema = z
  .object({
    type: z.literal("DIAGRAMS"),
    key: z.string().min(1).max(64),
    label: z.string().trim().min(1).max(80),
    items: z
      .array(
        z
          .object({
            key: z.string().regex(/^[a-z][a-zA-Z0-9-]*$/).max(64),
            label: z.string().trim().min(1).max(80),
            /** Application-relative, so nothing can point the form off-site. */
            asset: z.string().regex(/^\/[A-Za-z0-9/_-]+\.(png|jpe?g|svg)$/),
            alt: z.string().trim().min(1).max(200),
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict();

/**
 * A printed band of reference, closing the form: a drawing, and a table of
 * printed values beside it. Nothing in it is written in or stored.
 *
 * CUT成品檢查表 ends with the three core views that say what its A, B, C
 * and D measure, beside the 公差 table that says how far each may be off by
 * size. The table is text rather than part of the picture, so it prints
 * sharp and a screen reader can read it; the drawing is an asset, as the
 * DIAGRAMS band's pictures are.
 */
const referenceBandSectionSchema = z
  .object({
    type: z.literal("REFERENCE_BAND"),
    key: z.string().min(1).max(64),
    /** Not printed: names the band to assistive technology. */
    label: z.string().trim().min(1).max(80),
    drawing: z
      .object({
        asset: z.string().regex(/^\/[A-Za-z0-9/_-]+\.(png|jpe?g|svg)$/),
        alt: z.string().trim().min(1).max(300),
      })
      .strict()
      .optional(),
    // Optional: 特性檢驗報告單 closes on its core views alone.
    table: z
      .object({
        /** The corner cell, ruled corner to corner: across over, down under. */
        corner: z
          .object({
            across: z.string().trim().min(1).max(16),
            down: z.string().trim().min(1).max(16),
          })
          .strict(),
        columns: z
          .array(
            z
              .object({
                label: z.string().trim().min(1).max(16),
                note: z.string().trim().min(1).max(16).optional(),
              })
              .strict(),
          )
          .min(1)
          .max(12),
        rows: z
          .array(
            z
              .object({
                label: z.string().trim().min(1).max(24),
                values: z.array(z.string().trim().max(16)),
              })
              .strict(),
          )
          .min(1)
          .max(20),
      })
      .strict()
      .refine(
        (table) =>
          table.rows.every((row) => row.values.length === table.columns.length),
        { message: "every row needs one value per column", path: ["rows"] },
      )
      .optional(),
    /**
     * A space to write in, beside the table where another form puts its
     * drawing: 首件/巡迴檢驗單 prints `鋼捲號：` to the right of its 公差
     * table, over room for several coil numbers.
     */
    entry: templateFieldDefinitionSchema.optional(),
  })
  .strict()
  .refine((band) => band.drawing !== undefined || band.table !== undefined, {
    message: "a reference band prints a drawing, a table, or both",
  });

type AnyFieldDefinition = z.infer<typeof templateFieldDefinitionSchema>;
type AnySection =
  | z.infer<typeof fieldsSectionSchema>
  | z.infer<typeof fixedRowsSectionSchema>
  | z.infer<typeof matrixSectionSchema>
  | z.infer<typeof numberedGridSectionSchema>
  | z.infer<typeof numberedBlanksSectionSchema>
  | z.infer<typeof approvalSectionSchema>
  | z.infer<typeof diagramsSectionSchema>
  | z.infer<typeof referenceBandSectionSchema>;

/**
 * Every field rule a section carries, whatever its shape.
 *
 * Adding a section type without extending this would silently exempt it from
 * the approval guard below, so the switch is exhaustive rather than defaulting
 * to an empty list.
 */
export function sectionFields(section: AnySection): AnyFieldDefinition[] {
  switch (section.type) {
    case "FIELDS":
      return section.fields;
    case "FIXED_ROWS":
      return section.columns;
    case "MATRIX":
      return [
        ...section.groups.flatMap((group) => group.rows),
        ...(section.headingEntry ? [section.headingEntry.field] : []),
        ...(section.aside ? [section.aside.field] : []),
      ];
    case "NUMBERED_GRID":
      return [section.cell];
    case "NUMBERED_BLANKS":
      return [section.entry];
    // The reference band is printed, save the space beside it to write in.
    case "REFERENCE_BAND":
      return section.entry ? [section.entry] : [];
    case "APPROVAL_STATUS":
    // Printed illustrations. Nothing is stored and nothing is editable, so
    // there is no field rule for the approval guard to check.
    case "DIAGRAMS":
      return [];
  }
}

export const sheetTemplateDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.enum(["DRAFT_PENDING_CONFIRMATION", "APPROVED"]),
    templateKey: z.string().regex(/^[a-z][a-z0-9-]*$/).max(96),
    displayName: z.string().trim().min(1).max(160),
    /**
     * The printed document identifier, e.g. `文件編號：F/P5-07-01`.
     *
     * Both are omitted together on a form that prints neither. 大銀.直得's
     * 客戶訂購表 is the first: it carries no identifier anywhere, and
     * borrowing the one from the sheet beside it in the same workbook would
     * print a code onto a form that has none.
     */
    documentLabel: z.string().trim().min(1).max(80).optional(),
    documentCode: z.string().trim().min(1).max(64).optional(),
    /**
     * A printed mark beside the title, in the slot the date otherwise fills.
     *
     * 士林電機's 訂單表 prints the customer's name there: the form is
     * that customer's register and says so on its face. It is printed text,
     * never filled in, so it is reproduced where the paper puts it rather
     * than folded into the title or dropped.
     */
    headerNote: z.string().trim().min(1).max(40).optional(),
    /**
     * Printed lines above or below the title, never filled in.
     *
     * 巧力's 出廠檢驗單 has no letterhead: it prints who it is addressed to,
     * `TO: 採購部` with that office's telephone and fax, then the company
     * name over the title, and the customer beneath it.
     */
    headerLines: z
      .array(
        z
          .object({
            text: z.string().trim().min(1).max(80),
            // BOTTOM prints below the box, before the identifier: 首件/巡迴
            // 檢驗單's `單位：mm` at the left and its ✓/✗ key at the right,
            // on one line.
            placement: z.enum(["ABOVE", "BELOW", "BOTTOM"]),
            align: z.enum(["START", "CENTER", "END"]),
          })
          .strict(),
      )
      .min(1)
      .max(6)
      .optional(),
    /**
     * A printed mark below the box at the left, opposite the identifier —
     * 信太's form is marked `VER 2.0`, in red.
     */
    footerNote: z
      .object({
        text: z.string().trim().min(1).max(40),
        color: z
          .string()
          .regex(/^#[0-9a-f]{6}$/)
          .optional(),
      })
      .strict()
      .optional(),
    /**
     * Company stationery printed above the title.
     *
     * Only 加工製令單 carries one. It is page furniture rather than a section:
     * nothing is filled in on it and it sits outside the ruled form. Omitted
     * on every other transcription.
     */
    letterhead: z
      .object({
        asset: z.string().regex(/^\/[A-Za-z0-9/_-]+\.(png|jpe?g|svg)$/),
        alt: z.string().trim().min(1).max(200),
      })
      .strict()
      .optional(),
    /** Where the identifier prints. Ignored when there is none. */
    documentCodePosition: z
      .enum(["TOP_RIGHT", "BOTTOM_RIGHT", "BELOW_GRID_RIGHT"])
      .default("TOP_RIGHT"),
    /**
     * Printed arrangement of the title line. Published definitions that
     * predate this property remain byte-for-byte unchanged; callers resolve
     * their frozen legacy arrangement through resolveTemplateHeaderLayout.
     */
    // TITLE_FIELDS_RIGHT: the title, with every header field stacked to its
    // right — 個人生產日報表 prints 姓名 over 日期 there. The older layouts
    // print only the header's first field.
    headerLayout: z
      .enum([
        "DATE_TITLE_DOCUMENT",
        "TITLE_ONLY",
        "TITLE_LEFT_DATE_RIGHT",
        "TITLE_FIELDS_RIGHT",
      ])
      .optional(),
    /**
     * Immutable paper settings used by server-side PDF export. This is
     * optional only so already-published legacy definitions remain parseable
     * without being rewritten. Every newly published version must supply it.
     */
    printLayout: z
      .object({
        paperSize: z.literal("A4").default("A4"),
        orientation: z.enum(["PORTRAIT", "LANDSCAPE"]),
        marginMm: z.number().min(4).max(20).default(8),
        /**
         * The printed height of a register's rows. 特性檢驗報告單 fits
         * sixteen rows, its particulars and its core views on one sheet, as
         * the worksheet does, only at the worksheet's own row height.
         * Omitted means the renderer's default. 首件/巡迴檢驗單 packs two
         * inspection blocks and its 公差 table onto one portrait page, which
         * the worksheet only manages scaled to fit, so rows may go to 5mm.
         */
        rowHeightMm: z.number().min(5).max(14).optional(),
      })
      .strict()
      .optional(),
    ownerDepartmentCode: departmentCodeSchema,
    allowedCreatorDepartmentCodes: z
      .array(departmentCodeSchema)
      .min(1)
      .refine((codes) => new Set(codes).size === codes.length, {
        message: "Creator department codes must be unique",
      }),
    // Superseded, 2026-09-24. `allowedCreatorKinds`, `staffEditScope`,
    // `allowedEditorKinds` and `allowedSubmitterKinds` below, and each field's
    // `editableBy`, no longer decide anything: who may open, edit and submit a
    // sheet is set per department subpage (DESIGN.md §3.2.22), and the user
    // chose that it replaces these rather than sitting on top of them. They
    // stay in the schema because published definitions are immutable and
    // carry them; nothing reads them at runtime. What still binds is
    // `allowedCreatorDepartmentCodes` above and `workflow` below.
    /**
     * Which department identities may create a sheet from this template.
     *
     * Defaults to MANAGER only, which is the rule in `AGENTS.md` §5 and the
     * behaviour of every template published before 2026-08-08. Definitions
     * already stored in the database therefore keep working unchanged.
     */
    allowedCreatorKinds: z
      .array(membershipKindSchema)
      .min(1)
      .refine((kinds) => new Set(kinds).size === kinds.length, {
        message: "Creator kinds must be unique",
      })
      .default(["MANAGER"]),
    /**
     * How far a non-manager department editor's rights extend.
     *
     * `OWN_OR_ASSIGNED` keeps the spirit of `AGENTS.md` §5: an admitted
     * department identity may edit sheets they created or that were assigned
     * to them, but not a colleague's. `ANY_IN_DEPARTMENT` is an explicit
     * template policy. Ignored when only MANAGER may edit.
     */
    staffEditScope: z
      .enum(["OWN_OR_ASSIGNED", "ANY_IN_DEPARTMENT"])
      .default("OWN_OR_ASSIGNED"),
    /**
     * Which department identities may edit, when that is not the same set as
     * may create.
     *
     * Until 裁剪需求表 the two were always identical, so `allowedCreatorKinds`
     * was read for both. 平板剪 separates them: 主管 and 訂單人員 open the form,
     * while 員工 may fill it in but never start one. Omitted means "the same as
     * the creators", which is what every definition published before this
     * relies on.
     */
    allowedEditorKinds: z
      .array(membershipKindSchema)
      .min(1)
      .refine((kinds) => new Set(kinds).size === kinds.length, {
        message: "Editor kinds must be unique",
      })
      .optional(),
    /**
     * Which origin-department identities may submit DRAFT/RETURNED sheets.
     * Omitted definitions remain manager-only. Creation/editing permission
     * does not imply submission permission.
     */
    allowedSubmitterKinds: z
      .array(membershipKindSchema)
      .min(1)
      .refine((kinds) => new Set(kinds).size === kinds.length, {
        message: "Submitter kinds must be unique",
      })
      .default(["MANAGER"]),
    workflow: z
      .object({
        requiresReview: z.boolean(),
        approvalRoles: z.array(roleCodeSchema),
        destinationDepartmentCode: departmentCodeSchema,
        avoidSelfHandoff: z.boolean(),
        /**
         * The sheet stays in whichever department wrote it, and is never
         * sent on: 沖壓 and 平板剪 each keep their own 首件/巡迴檢驗單. The
         * destination above is then only the owning department's.
         */
        staysInOrigin: z.literal(true).optional(),
      })
      .strict(),
    sections: z
      .array(
        z.discriminatedUnion("type", [
          fieldsSectionSchema,
          fixedRowsSectionSchema,
          matrixSectionSchema,
          numberedGridSectionSchema,
          numberedBlanksSectionSchema,
          approvalSectionSchema,
          diagramsSectionSchema,
          referenceBandSectionSchema,
        ]),
      )
      .min(1),
    source: z
      .object({
        receivedDate: z.iso.date(),
        /**
         * SHA-256 of the supplied image file.
         *
         * Nullable so a transcription can be recorded before anyone has the
         * file on disk to fingerprint. It must be filled in before the
         * definition can be APPROVED — see the guard below. A fabricated hash
         * would be worse than an absent one, because it looks verifiable.
         */
        imageSha256: z.string().regex(/^[A-F0-9]{64}$/).nullable(),
        imageWidth: z.number().int().positive().nullable(),
        imageHeight: z.number().int().positive().nullable(),
        /**
         * What was actually fingerprinted. 分條製令單 was supplied as the Word
         * document the form is printed from, which has no pixel dimensions —
         * recording that here keeps `imageSha256` honest rather than implying
         * a photograph nobody has.
         */
        fileName: z.string().trim().min(1).max(200).nullable().default(null),
        mediaType: z.string().trim().min(1).max(120).nullable().default(null),
      })
      .strict(),
    openQuestions: z.array(z.string().trim().min(1).max(500)),
  })
  .strict()
  .superRefine((definition, context) => {
    // A number of lines only means something on a multi-line cell.
    definition.sections.forEach((section, sectionIndex) => {
      sectionFields(section).forEach((field) => {
        if (field.lines !== undefined && !field.multiline) {
          context.addIssue({
            code: "custom",
            path: ["sections", sectionIndex],
            message: `lines on ${field.key} needs multiline`,
          });
        }
      });
    });
    // Fields sharing a box in a FIELDS band are plain write-on values, side by
    // side, within one printed row.
    definition.sections.forEach((section, sectionIndex) => {
      if (section.type !== "FIELDS") return;
      for (const fields of resolveFieldRows(section)) {
        fields.forEach((field, index) => {
          if (!field.joinNext) return;
          const next = fields[index + 1];
          if (
            field.joinNext !== "INLINE" ||
            !next ||
            next.gridSpan ||
            [field, next].some((part) => part.printedOnly || part.choices || part.multiline)
          ) {
            context.addIssue({
              code: "custom",
              path: ["sections", sectionIndex],
              message: `${field.key} joins a plain write-on field after it in its row, inline`,
            });
          }
        });
      }
    });
    // A header on the worksheet's columns: every box says what it takes, and
    // every printed row fills the columns exactly.
    definition.sections.forEach((section, sectionIndex) => {
      if (section.type !== "FIELDS") return;
      if (!section.fieldGrid) {
        if (section.fields.some((field) => field.gridSpan) || section.asideDrawing) {
          context.addIssue({
            code: "custom",
            path: ["sections", sectionIndex],
            message: "gridSpan and asideDrawing need a fieldGrid on their section",
          });
        }
        return;
      }
      const aside = section.asideDrawing;
      const allColumns = section.fieldGrid.length;
      if (aside && (aside.columns >= allColumns || aside.startRow > (section.fieldRows?.length ?? 1))) {
        context.addIssue({
          code: "custom",
          path: ["sections", sectionIndex, "asideDrawing"],
          message: "asideDrawing leaves columns for the fields and starts on a printed row",
        });
      }
      const rows = resolveFieldRows(section);
      if (!section.fieldRows || rows.length !== section.fieldRows.length) {
        context.addIssue({
          code: "custom",
          path: ["sections", sectionIndex, "fieldRows"],
          message: "fieldGrid needs fieldRows that add up to the fields",
        });
        return;
      }
      rows.forEach((fields, rowIndex) => {
        // Rows beside the drawing fill the columns it leaves.
        const columns =
          aside && rowIndex + 1 >= aside.startRow ? allColumns - aside.columns : allColumns;
        let used = 0;
        // Fields joined into one box take that box's columns, set on its first.
        for (const [field] of fieldBoxes(fields)) {
          if (!field) continue;
          if (!field.gridSpan) {
            context.addIssue({
              code: "custom",
              path: ["sections", sectionIndex],
              message: `${field.key} needs a gridSpan on a fieldGrid`,
            });
            return;
          }
          if (field.printedOnly ? field.gridSpan.value !== 0 : field.gridSpan.value < 1) {
            context.addIssue({
              code: "custom",
              path: ["sections", sectionIndex],
              message: `${field.key}: a printed cell spans no box, and a field spans at least one`,
            });
          }
          used += field.gridSpan.label + field.gridSpan.value;
        }
        if (used !== columns) {
          context.addIssue({
            code: "custom",
            path: ["sections", sectionIndex, "fieldRows", rowIndex],
            message: `row ${rowIndex + 1} takes ${used} of ${columns} columns`,
          });
        }
      });
    });
    // Boxes to tick are drawn in a FIELDS band or a register's columns — 信太
    // ticks 合格 or 不合格 on every row — and hold a label, not a date. A
    // separator only means something between boxes.
    definition.sections.forEach((section, sectionIndex) => {
      sectionFields(section).forEach((field) => {
        if (field.choicesSeparator !== undefined && !field.choices) {
          context.addIssue({
            code: "custom",
            path: ["sections", sectionIndex],
            message: `choicesSeparator on ${field.key} needs choices`,
          });
        }
        if (
          (field.choiceWriteInSeparator !== undefined || field.choiceWriteInUnit !== undefined) &&
          field.choiceWriteIn === undefined
        ) {
          context.addIssue({
            code: "custom",
            path: ["sections", sectionIndex],
            message: `choiceWriteIn printing on ${field.key} needs choiceWriteIn`,
          });
        }
        if (
          field.choiceWriteIn !== undefined &&
          !field.choices?.includes(field.choiceWriteIn)
        ) {
          context.addIssue({
            code: "custom",
            path: ["sections", sectionIndex],
            message: `choiceWriteIn on ${field.key} must be one of its choices`,
          });
        }
        if (!field.choices) return;
        // A matrix may tick too: 製程檢驗's 龜裂 row takes 有 or 無 in every
        // round, and 首件檢驗's 類型 beside it C型 or 環型.
        if (
          (section.type !== "FIELDS" &&
            section.type !== "FIXED_ROWS" &&
            section.type !== "MATRIX") ||
          field.type !== "TEXT" ||
          field.printedOnly ||
          field.computed ||
          field.spacer
        ) {
          context.addIssue({
            code: "custom",
            path: ["sections", sectionIndex],
            message: `choices on ${field.key} need a TEXT field in a FIELDS, FIXED_ROWS or MATRIX section`,
          });
        }
      });
    });
    if (
      definition.workflow.requiresReview &&
      definition.workflow.approvalRoles.join(",") !==
        "SALES,ASSOCIATE,GENERAL_MANAGER"
    ) {
      context.addIssue({
        code: "custom",
        path: ["workflow", "approvalRoles"],
        message: "Review-required templates must use the complete approval order",
      });
    }
    if (
      definition.status === "APPROVED" &&
      (definition.openQuestions.length > 0 ||
        definition.sections.some((section) =>
          section.type === "APPROVAL_STATUS"
            ? section.blocks.some(
                (block) => block.transcriptionStatus !== "CONFIRMED",
              )
            : sectionFields(section).some(
                (field) =>
                  field.required === null ||
                  field.validationStatus !== "CONFIRMED",
              ),
        ))
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "Approved templates cannot contain unresolved transcription rules",
      });
    }
    if (
      definition.status === "APPROVED" &&
      definition.source.imageSha256 === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["source", "imageSha256"],
        message: "Approved templates must record the source image fingerprint",
      });
    }
    if (
      !definition.allowedCreatorKinds.includes("MANAGER") &&
      definition.workflow.requiresReview
    ) {
      // A review chain starts from the creating department's manager, so a
      // staff-only template cannot also require review.
      context.addIssue({
        code: "custom",
        path: ["allowedCreatorKinds"],
        message: "Review-required templates must allow manager creation",
      });
    }
  });

export const templateIdParamsSchema = z
  .object({ templateId: z.string().uuid() })
  .strict();

export const templateVersionParamsSchema = z
  .object({
    templateId: z.string().uuid(),
    versionId: z.string().uuid(),
  })
  .strict();

/**
 * Complete replacement payload for an unpublished template version.
 *
 * Published versions have no update contract: the API rejects this payload
 * once `publishedAt` is set and a correction must become a new version.
 */
export const saveTemplateVersionRequestSchema = z
  .object({
    clientMutationId: z.string().uuid(),
    definition: sheetTemplateDefinitionSchema,
    sourceReference: z.string().trim().min(1).max(2_000).nullable().default(null),
    changeNotes: z.string().trim().min(1).max(2_000).nullable().default(null),
  })
  .strict();

export const publishTemplateVersionRequestSchema = z
  .object({ clientMutationId: z.string().uuid(), active: z.boolean() })
  .strict();

export const updateTemplateActivationRequestSchema = z
  .object({ clientMutationId: z.string().uuid(), active: z.boolean() })
  .strict();

export type SheetTemplateDefinition = z.infer<
  typeof sheetTemplateDefinitionSchema
>;
export type TemplateHeaderLayout = NonNullable<
  SheetTemplateDefinition["headerLayout"]
>;
export type TemplatePrintLayout = NonNullable<
  SheetTemplateDefinition["printLayout"]
>;

/** Frozen interpretation for published definitions created before PDF export. */
export const LEGACY_TEMPLATE_PRINT_LAYOUT: TemplatePrintLayout = {
  paperSize: "A4",
  orientation: "LANDSCAPE",
  marginMm: 8,
};

export function resolveTemplatePrintLayout(
  definition: SheetTemplateDefinition,
): TemplatePrintLayout {
  return definition.printLayout ?? LEGACY_TEMPLATE_PRINT_LAYOUT;
}

/**
 * The identifier a form prints, or null when it prints none.
 *
 * Label and code are omitted together, so building the string by hand would
 * print `undefined` twice on 大銀.直得's 客戶訂購表. Every renderer asks here.
 */
/**
 * The value a computed cell shows, given the other cells of its row.
 *
 * One function because two renderers show it — the printed document and the
 * form — and a cell that disagreed between them would be worse than one that
 * was simply wrong.
 *
 * Empty when nothing has been entered: the worksheet shows 0 on every
 * untouched row only because the formula was dragged the length of the page,
 * and a blank printed form does not look like that.
 */
export function resolveComputedValue(
  computed: { kind: "PRODUCT_ROUNDED_UP"; factors: string[] },
  read: (key: string) => string | undefined,
): string {
  const entered = computed.factors.map((factor) => (read(factor) ?? "").trim());
  if (entered.every((value) => value === "")) return "";
  const numbers = entered.map((value) => Number(value));
  if (numbers.some((value) => !Number.isFinite(value))) return "";
  // ROUNDUP(x, 0) in the worksheet: 60 x 2.09 is 125.4 and the paper says 126.
  return String(Math.ceil(numbers.reduce((left, right) => left * right, 1)));
}

/**
 * Whether a row-grid cell is hidden inside a row group's spanning cell.
 *
 * 生產日報表 writes each person's name once, in a cell running down their
 * eight rows; it is stored on the block's first row. The same column on the
 * other seven rows is covered by that cell, so it is never drawn and the API
 * never accepts a value for it. One function, so the renderers and the API
 * cannot disagree about which cells exist.
 */
export function isRowGroupContinuation(
  section: {
    rowGroups?: { size: number; spanningColumnKey: string } | undefined;
  },
  rowIndex: number,
  columnKey: string,
): boolean {
  const groups = section.rowGroups;
  return (
    groups !== undefined &&
    columnKey === groups.spanningColumnKey &&
    rowIndex % groups.size !== 0
  );
}

/** The parts of a row grid that decide which of its cells exist and what they are called. */
type RowGridShape = {
  rowNumbers?: boolean | undefined;
  rowGroups?: { size: number; spanningColumnKey: string } | undefined;
  cornerCell?: { across: string; down: string } | undefined;
  standardRow?: { label: string } | undefined;
  columns: readonly { key: string }[];
};

/**
 * Whether a row-grid cell is covered by a printed corner cell. CUT成品檢查表
 * prints 尺寸 / 序號 in its first row's first cell; 特性檢驗報告單's corner
 * runs down beside its 標準值 row, covering that row's first cell too. When
 * the corner sits in a row-number column instead, as on 崧貿's copy, it
 * covers no data cell.
 */
export function isRowCornerCell(
  section: RowGridShape,
  rowIndex: number,
  columnKey: string,
): boolean {
  if (rowIndex !== 0 || columnKey !== section.columns[0]?.key) return false;
  if (section.cornerCell !== undefined) return true;
  return section.standardRow !== undefined && section.rowNumbers === false;
}

/**
 * Whether a field is a box anyone writes in at all.
 *
 * A printed-only cell is text on the form — 游標卡尺, 崧貿, 加工製令單's KG —
 * a computed cell is worked out from its row, and a spacer is a gap. None
 * is ever shown as a value anyone typed, so the API accepts nothing for
 * them: a value stored there would be data no screen or PDF could show.
 */
export function isWritableField(field: {
  printedOnly?: boolean | undefined;
  computed?: unknown;
  spacer?: boolean | undefined;
}): boolean {
  return !field.printedOnly && field.computed === undefined && !field.spacer;
}

/**
 * Whether a row-grid cell is a box anyone writes in: neither covered by a
 * row group's spanning cell nor by a printed corner cell. The API accepts a
 * value only where this holds, and submission checks only these cells.
 */
export function isWrittenRowCell(
  section: RowGridShape,
  rowIndex: number,
  columnKey: string,
): boolean {
  return (
    !isRowGroupContinuation(section, rowIndex, columnKey) &&
    !isRowCornerCell(section, rowIndex, columnKey)
  );
}

/**
 * The number printed beside a row. Rows under a standard row count from 1,
 * because the standard is not a test.
 */
export function printedRowNumber(section: RowGridShape, rowIndex: number): number {
  return section.standardRow ? rowIndex : rowIndex + 1;
}

/**
 * What a row is called, for a screen reader and for an error message: 標準值
 * or 尺寸 for a row a corner names, 第 2 位 第 3 列 on a form of people, and
 * 第 3 列 everywhere else. One function, so the form and its messages agree.
 */
export function describeRow(
  section: RowGridShape & { cornerCell?: { across: string; down: string } | undefined },
  rowIndex: number,
): string {
  const groups = section.rowGroups;
  if (groups) {
    return `第 ${Math.floor(rowIndex / groups.size) + 1} 位 第 ${(rowIndex % groups.size) + 1} 列`;
  }
  if (rowIndex === 0 && section.cornerCell) return section.cornerCell.across;
  if (rowIndex === 0 && section.standardRow) return section.standardRow.label;
  return `第 ${printedRowNumber(section, rowIndex)} 列`;
}

/**
 * The printed state of a set of boxes to tick: `■OK □NG` once OK is ticked,
 * `□合格 / □不合格` where the paper separates them with a slash. One
 * function, so the PDF and any text rendering agree.
 */
export function formatChoices(
  choices: readonly string[],
  value: string | undefined,
  separator = " ",
  writeIn?: string,
  writeInPrinting: { separator?: string | undefined; unit?: string | undefined } = {},
): string {
  const ticked = readChoice(value, writeIn);
  return choices
    .map((choice) => {
      const box = `${ticked.choice === choice ? "■" : "□"}${choice}`;
      // The write-in box prints what leads its line whether or not it is
      // ticked, as the paper does, then what was written and any unit.
      return choice === writeIn
        ? `${box}${writeInPrinting.separator ?? "："}${ticked.text}${writeInPrinting.unit ?? ""}`
        : box;
    })
    .join(separator);
}

// Typed from the field schema rather than the register schema, whose own
// checks call these helpers.
type RegisterColumn = z.infer<typeof templateFieldDefinitionSchema>;
type RegisterSection = {
  columns: RegisterColumn[];
  headingGroups?:
    | { label: string; columnKeys: string[]; subheadings: boolean }[]
    | undefined;
};

/**
 * A register's printed cells, left to right. Most hold one column; columns
 * joined with `joinNext` share one — `E: ＿K* ＿箱` — laid out inline or
 * stacked. Widths, headings and rendering all count printed cells.
 */
export function printedCells(section: Pick<RegisterSection, "columns">): {
  columns: RegisterColumn[];
  layout: "INLINE" | "STACKED" | null;
}[] {
  const cells: { columns: RegisterColumn[]; layout: "INLINE" | "STACKED" | null }[] = [];
  let open: (typeof cells)[number] | null = null;
  for (const column of section.columns) {
    if (open) open.columns.push(column);
    else {
      open = { columns: [column], layout: column.joinNext ?? null };
      cells.push(open);
    }
    if (!column.joinNext) open = null;
  }
  return cells;
}

/**
 * A register's heading rows. One row, one heading per printed cell, unless
 * the register groups headings: then a first row whose group headings span
 * their cells — running down both rows where they print nothing under them —
 * and a second row of the headings under the groups that print them.
 */
export function headingRows(section: RegisterSection): {
  label: string;
  cells: number;
  rows: 1 | 2;
  column: RegisterColumn | null;
}[][] {
  const cells = printedCells(section);
  const groups = section.headingGroups ?? [];
  const own = (cell: (typeof cells)[number]) => ({
    label: cell.columns[0]!.label,
    cells: 1,
    column: cell.columns[0]!,
  });
  if (groups.length === 0) return [cells.map((cell) => ({ ...own(cell), rows: 1 as const }))];
  const first: ReturnType<typeof headingRows>[number] = [];
  const second: ReturnType<typeof headingRows>[number] = [];
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index]!;
    const group = groups.find((candidate) => candidate.columnKeys[0] === cell.columns[0]!.key);
    if (!group) {
      first.push({ ...own(cell), rows: 2 });
      continue;
    }
    const covered = cells.filter((candidate) =>
      group.columnKeys.includes(candidate.columns[0]!.key),
    );
    first.push({
      label: group.label,
      cells: covered.length,
      rows: group.subheadings ? 1 : 2,
      column: null,
    });
    if (group.subheadings) {
      for (const under of covered) second.push({ ...own(under), rows: 1 });
    }
    index += covered.length - 1;
  }
  return [first, second];
}

/**
 * A ticked value read back into the box and anything written after it:
 * `其他：2/23` is 其他 with 2/23 written on its line. Without a write-in
 * choice the whole value is the box.
 */
export function readChoice(
  value: string | undefined,
  writeIn?: string,
): { choice: string; text: string } {
  const stored = value ?? "";
  if (writeIn !== undefined && stored.startsWith(`${writeIn}：`)) {
    return { choice: writeIn, text: stored.slice(writeIn.length + 1) };
  }
  return { choice: stored, text: "" };
}

/**
 * Whether a value is one the boxes can hold: nothing, a box's label, or the
 * write-in box with what was written after it. The API refuses anything else.
 */
export function isChoiceValue(
  choices: readonly string[],
  value: string,
  writeIn?: string,
): boolean {
  if (value === "") return true;
  const { choice } = readChoice(value, writeIn);
  return choices.includes(choice);
}

export function resolveDocumentIdentifier(
  definition: Pick<SheetTemplateDefinition, "documentLabel" | "documentCode">,
): string | null {
  if (!definition.documentLabel || !definition.documentCode) return null;
  return `${definition.documentLabel}${definition.documentCode}`;
}

export function resolveTemplateHeaderLayout(
  definition: SheetTemplateDefinition,
): TemplateHeaderLayout {
  if (definition.headerLayout) return definition.headerLayout;
  // Before headerLayout existed, BOTTOM_RIGHT was the production-order signal
  // that its FIELDS band belonged inside the printed grid rather than above it.
  return definition.documentCodePosition === "BOTTOM_RIGHT"
    ? "TITLE_ONLY"
    : "DATE_TITLE_DOCUMENT";
}
/**
 * The fields of a FIELDS section, grouped into the rows the paper prints.
 *
 * A definition with no `fieldRows`, or one whose counts do not add up to the
 * fields it has, prints as a single row: that is what every form transcribed
 * before this did, and a header that has lost a row is still readable, whereas
 * one that has silently dropped a field is not.
 */
export function resolveFieldRows<Field>(section: {
  fields: readonly Field[];
  fieldRows?: readonly number[] | undefined;
}): Field[][] {
  const counts = section.fieldRows;
  const total = counts?.reduce((sum, count) => sum + count, 0);
  if (!counts || total !== section.fields.length) return [[...section.fields]];
  let cursor = 0;
  return counts.map((count) => section.fields.slice(cursor, (cursor += count)));
}

/**
 * A printed row's boxes, left to right. Most hold one field; fields joined
 * with `joinNext` are written in one box under the first one's label —
 * 退火明細表's 程式編號 is `＿ 第 ＿ 程式 ＿`, three values in one box.
 */
export function fieldBoxes<Field extends { joinNext?: string | undefined }>(
  fields: readonly Field[],
): Field[][] {
  const boxes: Field[][] = [];
  let open: Field[] | null = null;
  for (const field of fields) {
    if (open) open.push(field);
    else {
      open = [field];
      boxes.push(open);
    }
    if (!field.joinNext) open = null;
  }
  return boxes;
}


export type TemplateFieldDefinition = z.infer<
  typeof templateFieldDefinitionSchema
>;
export type SaveTemplateVersionRequest = z.infer<
  typeof saveTemplateVersionRequestSchema
>;
