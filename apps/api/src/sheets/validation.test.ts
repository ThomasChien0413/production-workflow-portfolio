import { describe, expect, it } from "vitest";
import {
  cutCharacteristicInspectionV1,
  cutDailyReportV1,
  cutFinishedInspectionV1,
  cutPersonalDailyReportV1,
  slittingRequestV1,
} from "@workflow/contracts";
import { validateForSubmission } from "./values.js";

/**
 * The fixed-row rules the user confirmed on 2026-08-08 (DESIGN.md §6.1):
 * a row may be left entirely blank, a started row must be completed, and at
 * least one row must be complete before submission.
 *
 * These are business decisions rather than derived behaviour, so they are
 * pinned directly. The integration suite covers the surrounding workflow but
 * never exercises a partly filled row.
 */

const ROW_KEY = "items";
const DATE_KEY = "requestDate";

function row(overrides: Record<string, string> = {}) {
  return {
    specification: "示意規格",
    material: "示意材質",
    category: "示意分類",
    requiredQuantity: "100",
    notes: "示意備註",
    ...overrides,
  };
}

function sheet(rows: unknown[], date = "2026-08-08") {
  return { [DATE_KEY]: date, [ROW_KEY]: rows };
}

describe("分條申請單 submission validation", () => {
  it("accepts one complete row with the remaining seven left blank", () => {
    expect(validateForSubmission(slittingRequestV1, sheet([row()]))).toEqual([]);
  });

  it("ignores rows the user never touched", () => {
    const rows = [row(), {}, {}, {}, {}, {}, {}, {}];
    expect(validateForSubmission(slittingRequestV1, sheet(rows))).toEqual([]);
  });

  it("requires every column once a row has been started", () => {
    // Only 規格 filled: the other four become required for that row.
    const rows = [row(), { specification: "只填了規格" }];
    const issues = validateForSubmission(slittingRequestV1, sheet(rows));

    expect(issues).toContain(`${ROW_KEY}.1.material`);
    expect(issues).toContain(`${ROW_KEY}.1.category`);
    expect(issues).toContain(`${ROW_KEY}.1.requiredQuantity`);
    expect(issues).toContain(`${ROW_KEY}.1.notes`);
    // The started column itself is satisfied, and the complete row is untouched.
    expect(issues).not.toContain(`${ROW_KEY}.1.specification`);
    expect(issues.filter((issue) => issue.startsWith(`${ROW_KEY}.0.`))).toEqual([]);
  });

  it("treats whitespace as absent rather than as a value", () => {
    const rows = [row({ material: "   " })];
    expect(validateForSubmission(slittingRequestV1, sheet(rows))).toContain(
      `${ROW_KEY}.0.material`,
    );
  });

  it("rejects a sheet with no completed row", () => {
    expect(validateForSubmission(slittingRequestV1, sheet([]))).toContain(
      `${ROW_KEY}.minimumCompletedRows`,
    );
  });

  it("rejects a sheet whose only row is incomplete", () => {
    const issues = validateForSubmission(
      slittingRequestV1,
      sheet([{ specification: "只填了規格" }]),
    );
    expect(issues).toContain(`${ROW_KEY}.minimumCompletedRows`);
  });

  it("requires the header date", () => {
    expect(validateForSubmission(slittingRequestV1, sheet([row()], ""))).toContain(
      DATE_KEY,
    );
  });

  it("rejects a malformed header date", () => {
    expect(
      validateForSubmission(slittingRequestV1, sheet([row()], "2026-13-99")),
    ).toContain(DATE_KEY);
  });
});

describe("生產日報表 row groups", () => {
  const rows = cutDailyReportV1.sections[1];
  if (rows?.type !== "FIXED_ROWS") throw new Error("expected FIXED_ROWS");
  // Every cell required, so a row that is judged started must be complete.
  const strict = {
    ...cutDailyReportV1,
    sections: [
      cutDailyReportV1.sections[0]!,
      { ...rows, columns: rows.columns.map((column) => ({ ...column, required: true })) },
      cutDailyReportV1.sections[2]!,
    ],
  };
  const work = { workContent: "捲繞", quantity: "50", time: "4h", note: "-" };

  it("asks for a person's name once, on the first row of their block", () => {
    const entries = Array.from({ length: 64 }, () => ({}));
    entries[0] = { name: "粘靜鴻", ...work };
    // The block's second row has no name of its own: it is covered by the
    // cell spanning the block, so it is not missing one.
    entries[1] = { ...work };
    expect(validateForSubmission(strict, { entries })).toEqual([]);
  });

  it("still asks for the name when the block's first row has none", () => {
    const entries = Array.from({ length: 64 }, () => ({}));
    entries[8] = { ...work };
    expect(validateForSubmission(strict, { entries })).toEqual(["entries.8.name"]);
  });

  it("does not count a stray value under the spanning cell as a started row", () => {
    const entries = Array.from({ length: 64 }, () => ({}));
    entries[3] = { name: "看不見" };
    expect(validateForSubmission(strict, { entries })).toEqual([]);
  });
});

describe("optional header dates", () => {
  it("lets a date that is not required be left blank, but not be wrong", () => {
    const blank = { name: "", reportDate: "", work: [] };
    expect(validateForSubmission(cutPersonalDailyReportV1, blank)).toEqual([]);
    expect(
      validateForSubmission(cutPersonalDailyReportV1, { ...blank, reportDate: "2026-02-30" }),
    ).toEqual(["reportDate"]);
  });

  it("still requires a required date", () => {
    expect(validateForSubmission(slittingRequestV1, { requestDate: "", items: [] })).toContain(
      "requestDate",
    );
  });
});

describe("CUT成品檢查表 corner cell", () => {
  const rows = cutFinishedInspectionV1.sections[2];
  if (rows?.type !== "FIXED_ROWS") throw new Error("expected FIXED_ROWS");
  const strict = {
    ...cutFinishedInspectionV1,
    sections: cutFinishedInspectionV1.sections.map((section) =>
      section === rows
        ? { ...rows, columns: rows.columns.map((column) => ({ ...column, required: true })) }
        : section,
    ),
  };
  const sizes = { a: "12", b: "40", c: "64", d: "25", note: "-" };

  it("does not ask for a 序號 in the printed corner of the 尺寸 row", () => {
    const dimensions = Array.from({ length: 9 }, () => ({}));
    dimensions[0] = { ...sizes };
    expect(validateForSubmission(strict, { dimensions })).toEqual([]);
  });

  it("still asks for the 序號 of a measured piece", () => {
    const dimensions = Array.from({ length: 9 }, () => ({}));
    dimensions[1] = { ...sizes };
    expect(validateForSubmission(strict, { dimensions })).toEqual(["dimensions.1.item"]);
  });
});

describe("特性檢驗報告單 standard row", () => {
  const rows = cutCharacteristicInspectionV1.sections[1];
  if (rows?.type !== "FIXED_ROWS") throw new Error("expected FIXED_ROWS");
  const strict = {
    ...cutCharacteristicInspectionV1,
    sections: cutCharacteristicInspectionV1.sections.map((section) =>
      section === rows
        ? { ...rows, columns: rows.columns.map((column) => ({ ...column, required: true })) }
        : section,
    ),
  };
  const reading = { a: "12", b: "40", c: "64", d: "25", current: "35", ironLoss: "1.2" };

  it("does not ask for a 測試值 under the corner beside the standard", () => {
    const tests = Array.from({ length: 16 }, () => ({}));
    tests[0] = { ...reading };
    expect(validateForSubmission(strict, { tests })).toEqual([]);
  });

  it("still asks for it on a test row", () => {
    const tests = Array.from({ length: 16 }, () => ({}));
    tests[1] = { ...reading };
    expect(validateForSubmission(strict, { tests })).toEqual(["tests.1.sample"]);
  });
});
