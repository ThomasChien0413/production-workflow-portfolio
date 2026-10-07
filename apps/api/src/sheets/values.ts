import { createHash } from "node:crypto";
import {
  isChoiceValue,
  matrixCellChoices,
  matrixWrittenColumns,
  isWritableField,
  isWrittenRowCell,
  type SheetTemplateDefinition,
} from "@workflow/contracts";
import { ConflictError } from "../auth/errors.js";

/**
 * A sheet's stored values, walked against its pinned template: what a new
 * sheet starts with, which keys may be written and how, and what submission
 * requires. Nothing here touches the database.
 */

export type FieldRule = {
  type: "DATE" | "TEXT";
  required: boolean | null;
  reviewed: boolean;
  editableBy: readonly (
    | "ORIGIN_MANAGER"
    | "ORIGIN_ORDER_TAKER"
    | "ORIGIN_STAFF"
  )[];
  bindsTo?: "DUE_AT" | undefined;
  choices?: readonly string[] | undefined;
  choiceWriteIn?: string | undefined;
  editableStates: SheetTemplateDefinition["sections"][number] extends infer _T
    ? readonly string[]
    : never;
};

export function initialValues(definition: SheetTemplateDefinition): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const section of definition.sections) {
    if (section.type === "FIELDS") {
      for (const field of section.fields) values[field.key] = "";
    }
    if (section.type === "FIXED_ROWS") {
      values[section.key] = Array.from({ length: section.rowCount }, () =>
        Object.fromEntries(section.columns.map((column) => [column.key, ""])),
      );
    }
    if (section.type === "MATRIX") {
      // Keyed by printed row then printed column: both axes come from the form,
      // so neither is an index that could shift.
      values[section.key] = Object.fromEntries(
        section.groups.flatMap((group) =>
          group.rows.map((row) => [
            row.key,
            Object.fromEntries(section.columns.map((column) => [column.key, ""])),
          ]),
        ),
      );
      // A written-in heading holds one value per part, per column: 製程檢驗's
      // `＿日 ＿時 ＿分` for each round.
      const entry = section.headingEntry;
      if (entry) {
        (values[section.key] as Record<string, unknown>)[entry.field.key] = Object.fromEntries(
          section.columns.map((column) => [
            column.key,
            Object.fromEntries(entry.parts.map((part) => [part.key, ""])),
          ]),
        );
      }
      if (section.aside) values[section.aside.field.key] = "";
    }
    if (section.type === "REFERENCE_BAND" && section.entry) {
      values[section.entry.key] = "";
    }
    if (section.type === "NUMBERED_GRID") {
      values[section.key] = Array.from({ length: section.rowCount }, () =>
        Array.from({ length: section.columnCount }, () => ""),
      );
    }
    if (section.type === "NUMBERED_BLANKS") {
      values[section.key] = Array.from({ length: section.count }, () => "");
    }
  }
  return values;
}

/**
 * Every field key a client may write, with the rule that governs it.
 *
 * Exported for direct unit testing. A key absent here is refused by
 * patchValues, so this is where "nobody writes there" is enforced: printed
 * text, computed cells, spacers, and cells a row group or corner covers.
 */
export function fieldRules(definition: SheetTemplateDefinition): Map<string, FieldRule> {
  const rules = new Map<string, FieldRule>();
  for (const section of definition.sections) {
    if (section.type === "FIELDS") {
      for (const field of section.fields) {
        if (!isWritableField(field)) continue;
        rules.set(field.key, field);
      }
    }
    if (section.type === "FIXED_ROWS") {
      for (let row = 0; row < section.rowCount; row += 1) {
        for (const column of section.columns) {
          if (!isWritableField(column)) continue;
          // Covered by a row group's spanning cell, or the printed corner
          // cell: nobody writes there, so nothing may be stored there.
          if (!isWrittenRowCell(section, row, column.key)) continue;
          rules.set(`${section.key}.${row}.${column.key}`, column);
        }
      }
    }
    if (section.type === "MATRIX") {
      for (const group of section.groups) {
        for (const row of group.rows) {
          if (!isWritableField(row)) continue;
          // A row printed as one cell across several columns stores under the
          // first alone; a column of boxes to tick governs its own cells.
          for (const column of matrixWrittenColumns(section, row)) {
            const choices = matrixCellChoices(column, row);
            rules.set(
              `${section.key}.${row.key}.${column.key}`,
              column.choices
                ? { ...row, choices, choiceWriteIn: undefined }
                : choices
                  ? row
                  : { ...row, choices: undefined, choiceWriteIn: undefined },
            );
          }
        }
      }
      const entry = section.headingEntry;
      if (entry && isWritableField(entry.field)) {
        for (const column of section.columns) {
          for (const part of entry.parts) {
            rules.set(
              `${section.key}.${entry.field.key}.${column.key}.${part.key}`,
              entry.field,
            );
          }
        }
      }
      if (section.aside && isWritableField(section.aside.field)) {
        rules.set(section.aside.field.key, section.aside.field);
      }
    }
    if (section.type === "REFERENCE_BAND" && section.entry && isWritableField(section.entry)) {
      rules.set(section.entry.key, section.entry);
    }
    if (section.type === "NUMBERED_GRID" && isWritableField(section.cell)) {
      for (let row = 0; row < section.rowCount; row += 1) {
        for (let column = 0; column < section.columnCount; column += 1) {
          rules.set(`${section.key}.${row}.${column}`, section.cell);
        }
      }
    }
    if (section.type === "NUMBERED_BLANKS" && isWritableField(section.entry)) {
      for (let index = 0; index < section.count; index += 1) {
        rules.set(`${section.key}.${index}`, section.entry);
      }
    }
  }
  return rules;
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function validateFieldValue(fieldKey: string, rule: FieldRule, value: unknown): void {
  if (typeof value !== "string") {
    throw new ConflictError(`欄位 ${fieldKey} 必須是文字`);
  }
  if (value.length > 2000) {
    throw new ConflictError(`欄位 ${fieldKey} 超過長度限制`);
  }
  if (rule.type === "DATE" && value !== "" && !isValidIsoDate(value)) {
    throw new ConflictError(`欄位 ${fieldKey} 必須是有效日期`);
  }
  // Boxes to tick hold the ticked label or nothing, and a write-in box what
  // was written after it.
  if (rule.choices && !isChoiceValue(rule.choices, value, rule.choiceWriteIn)) {
    throw new ConflictError(`欄位 ${fieldKey} 只能勾選 ${rule.choices.join("、")}`);
  }
}

/**
 * Walk a dotted field key through the stored value tree.
 *
 * Keys differ by section type — `requestDate`, `items.0.specification`,
 * `inspectionRecord.thickness.record1`, `knifeArrangement.0.3`,
 * `issuedCoilNumbers.4` — so the walker resolves each segment against whatever
 * container it finds: a numeric segment indexes an array, anything else keys an
 * object. It never creates containers, so a key the template did not define
 * fails rather than silently growing the stored shape.
 */
function resolveContainer(
  values: Record<string, unknown>,
  parts: string[],
): Record<string, unknown> | unknown[] | undefined {
  let current: unknown = values;
  for (const part of parts) {
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
    } else if (current && typeof current === "object") {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current && typeof current === "object"
    ? (current as Record<string, unknown> | unknown[])
    : undefined;
}

export function setFieldValue(
  values: Record<string, unknown>,
  fieldKey: string,
  value: unknown,
): void {
  const parts = fieldKey.split(".");
  const last = parts.pop()!;
  const container = resolveContainer(values, parts);
  if (!container) throw new ConflictError(`欄位 ${fieldKey} 不存在`);

  if (Array.isArray(container)) {
    const index = Number(last);
    if (!Number.isInteger(index) || index < 0 || index >= container.length) {
      throw new ConflictError(`欄位 ${fieldKey} 不存在`);
    }
    container[index] = value;
    return;
  }
  if (!(last in container)) throw new ConflictError(`欄位 ${fieldKey} 不存在`);
  container[last] = value;
}

export function getFieldValue(values: Record<string, unknown>, fieldKey: string): unknown {
  const parts = fieldKey.split(".");
  const last = parts.pop()!;
  const container = resolveContainer(values, parts);
  if (!container) return undefined;
  return Array.isArray(container)
    ? container[Number(last)]
    : container[last];
}

function textPresent(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Exported for direct unit testing. The fixed-row rules it enforces were
 * confirmed by the user (DESIGN.md §6.1) and are otherwise only reachable
 * through a database-backed submission, which makes them easy to regress
 * unnoticed.
 */
export function validateForSubmission(
  definition: SheetTemplateDefinition,
  values: Record<string, unknown>,
): string[] {
  const issues: string[] = [];
  for (const section of definition.sections) {
    if (section.type === "FIELDS") {
      for (const field of section.fields) {
        if (!isWritableField(field)) continue;
        const value = values[field.key];
        if (field.required && !textPresent(value)) issues.push(field.key);
        // A date written must be a real one; a date that is not required may
        // be left blank, as the daily reports' 日期 may.
        else if (
          field.type === "DATE" &&
          typeof value === "string" &&
          value !== "" &&
          !isValidIsoDate(value)
        ) {
          issues.push(field.key);
        }
      }
    }
    if (section.type === "FIXED_ROWS") {
      const sectionValue = values[section.key];
      const rows: unknown[] = Array.isArray(sectionValue) ? sectionValue : [];
      let completeRows = 0;
      for (let rowIndex = 0; rowIndex < section.rowCount; rowIndex += 1) {
        const row = rows[rowIndex];
        const record = row && typeof row === "object" && !Array.isArray(row)
          ? (row as Record<string, unknown>)
          : {};
        // Only boxes someone writes in count: not printed text, a computed
        // cell or a spacer, not a row group's spanning cell below the
        // block's first row, and not a printed corner cell.
        const cells = section.columns.filter(
          (column) =>
            isWritableField(column) && isWrittenRowCell(section, rowIndex, column.key),
        );
        const started = cells.some((column) => textPresent(record[column.key]));
        if (!started && section.rowRequirement === "COMPLETE_IF_STARTED") continue;
        const missing = cells.filter(
          (column) => column.required && !textPresent(record[column.key]),
        );
        if (missing.length === 0) completeRows += 1;
        else {
          issues.push(
            ...missing.map((column) => `${section.key}.${rowIndex}.${column.key}`),
          );
        }
      }
      if (completeRows < section.minimumCompletedRows) {
        issues.push(`${section.key}.minimumCompletedRows`);
      }
    }
    if (section.type === "MATRIX") {
      const stored = values[section.key];
      const rows =
        stored && typeof stored === "object" && !Array.isArray(stored)
          ? (stored as Record<string, unknown>)
          : {};
      for (const group of section.groups) {
        for (const row of group.rows) {
          if (!row.required) continue;
          const cells = rows[row.key];
          const record =
            cells && typeof cells === "object" && !Array.isArray(cells)
              ? (cells as Record<string, unknown>)
              : {};
          for (const column of matrixWrittenColumns(section, row)) {
            if (!textPresent(record[column.key])) {
              issues.push(`${section.key}.${row.key}.${column.key}`);
            }
          }
        }
      }
    }
    if (section.type === "NUMBERED_GRID" && section.cell.required) {
      const stored = Array.isArray(values[section.key])
        ? (values[section.key] as unknown[])
        : [];
      for (let row = 0; row < section.rowCount; row += 1) {
        const line = Array.isArray(stored[row]) ? (stored[row] as unknown[]) : [];
        for (let column = 0; column < section.columnCount; column += 1) {
          if (!textPresent(line[column])) {
            issues.push(`${section.key}.${row}.${column}`);
          }
        }
      }
    }
    if (section.type === "NUMBERED_BLANKS" && section.entry.required) {
      const stored = Array.isArray(values[section.key])
        ? (values[section.key] as unknown[])
        : [];
      for (let index = 0; index < section.count; index += 1) {
        if (!textPresent(stored[index])) issues.push(`${section.key}.${index}`);
      }
    }
  }
  return [...new Set(issues)];
}

export function reviewedDataFingerprint(
  definition: SheetTemplateDefinition,
  values: Record<string, unknown>,
): string {
  const reviewedValues = [...fieldRules(definition)]
    .filter(([, rule]) => rule.reviewed)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([fieldKey]) => [fieldKey, getFieldValue(values, fieldKey)]);
  return createHash("sha256")
    .update(JSON.stringify(reviewedValues))
    .digest("hex");
}
