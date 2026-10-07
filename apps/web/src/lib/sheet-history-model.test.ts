import { describe, expect, it } from "vitest";
import {
  DEFAULT_HISTORY_SORT,
  describeHistorySort,
  historyAriaSort,
  nextHistorySort,
  parseHistorySort,
} from "./sheet-history-model.js";

describe("department sheet history sorting", () => {
  it("falls back safely and applies each column's useful first direction", () => {
    expect(parseHistorySort("unknown", "asc")).toEqual(DEFAULT_HISTORY_SORT);
    expect(parseHistorySort("sheetNumber", undefined)).toEqual({
      key: "sheetNumber",
      direction: "asc",
    });
    // 負責員工 went with assignment (the user, 2026-10-04).
    expect(parseHistorySort("employee", "asc")).toEqual(DEFAULT_HISTORY_SORT);
    expect(nextHistorySort(DEFAULT_HISTORY_SORT, "template")).toEqual({
      key: "template",
      direction: "asc",
    });
  });

  it("reverses active columns and states the order accessibly", () => {
    const sort = nextHistorySort(DEFAULT_HISTORY_SORT, "completedAt");
    expect(sort).toEqual({ key: "completedAt", direction: "asc" });
    expect(historyAriaSort(sort, "completedAt")).toBe("ascending");
    expect(historyAriaSort(sort, "template")).toBe("none");
    expect(describeHistorySort(sort)).toBe("最早完成的排在前面");
  });
});
