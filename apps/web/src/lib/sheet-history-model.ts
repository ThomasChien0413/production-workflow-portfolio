import type {
  DepartmentSheetHistoryPage,
  DepartmentSheetHistorySort,
} from "@workflow/contracts";

export type { DepartmentSheetHistoryPage, DepartmentSheetHistorySort };
export type HistoryDirection = "asc" | "desc";

export type HistorySort = {
  key: DepartmentSheetHistorySort;
  direction: HistoryDirection;
};

export const DEFAULT_HISTORY_SORT: HistorySort = {
  key: "completedAt",
  direction: "desc",
};

export const HISTORY_SORT_LABEL: Record<DepartmentSheetHistorySort, string> = {
  completedAt: "完成時間",
  sheetNumber: "工單編號",
  template: "表單範本",
};

const FIRST_DIRECTION: Record<DepartmentSheetHistorySort, HistoryDirection> = {
  completedAt: "desc",
  sheetNumber: "asc",
  template: "asc",
};

function isHistorySort(value: unknown): value is DepartmentSheetHistorySort {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(HISTORY_SORT_LABEL, value)
  );
}

export function parseHistorySort(
  key: string | string[] | undefined,
  direction: string | string[] | undefined,
): HistorySort {
  if (!isHistorySort(key)) return DEFAULT_HISTORY_SORT;
  return {
    key,
    direction:
      direction === "asc" || direction === "desc"
        ? direction
        : FIRST_DIRECTION[key],
  };
}

export function nextHistorySort(
  current: HistorySort,
  key: DepartmentSheetHistorySort,
): HistorySort {
  if (current.key !== key) return { key, direction: FIRST_DIRECTION[key] };
  return {
    key,
    direction: current.direction === "asc" ? "desc" : "asc",
  };
}

export function historyAriaSort(
  current: HistorySort,
  key: DepartmentSheetHistorySort,
): "ascending" | "descending" | "none" {
  if (current.key !== key) return "none";
  return current.direction === "asc" ? "ascending" : "descending";
}

export function describeHistorySort(sort: HistorySort): string {
  const ascending = sort.direction === "asc";
  switch (sort.key) {
    case "completedAt":
      return ascending ? "最早完成的排在前面" : "最近完成的排在前面";
    case "sheetNumber":
      return `依工單編號${ascending ? "由小到大" : "由大到小"}排序`;
    case "template":
      return `依表單範本${ascending ? "正向" : "反向"}排序`;
  }
}
