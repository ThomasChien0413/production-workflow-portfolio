"use client";

import { Fragment, type ReactNode } from "react";
import {
  fieldBoxes,
  matrixCellChoices,
  matrixRowCells,
  readChoice,
  resolveFieldRows,
} from "@workflow/contracts";
import type { TemplateSection } from "@/lib/sheet-model";
/**
 * The printed bands of a sheet form that are not its row grid: label/value
 * rows, inspection matrices, numbered grids and blanks, diagrams, the
 * reference table and signatures. Each renders one section of the pinned
 * template exactly as the paper lays it out; SheetForm owns the values and
 * decides what is editable.
 */

export type BandProps<T> = {
  section: T;
  values: Map<string, string>;
  editable: (field: { editableStates: string[]; editableBy: string[] }) => boolean;
  onEdit: (key: string, value: string) => void;
  onBlur: () => void;
};

/**
 * A printed row of label/value pairs — 日期 / 材料寬度 / 材料材質 across the
 * top of 分條製令單, and 檢驗員 across the bottom beside the document number.
 *
 * Rendered as a table row rather than a form group because that is what it is
 * on paper: one row of the same grid as everything below it.
 */
export function FieldsBand({
  section,
  values,
  editable,
  onEdit,
  onBlur,
  documentCode,
}: BandProps<Extract<TemplateSection, { type: "FIELDS" }>> & {
  /** Printed at the end of the row when the form carries it there. */
  documentCode: string | null;
}) {
  // The paper wraps a long header across several rows; a definition that says
  // where keeps the screen and the printed sheet the same shape.
  const printedRows = resolveFieldRows(section);
  const last = printedRows.length - 1;

  // A label set in red on the paper, as 信太 prints 檢驗日期, and one printed
  // on two lines, as its note on which voltage gives which current.
  const labelStyle = (field: (typeof section.fields)[number]) => {
    const twoLines = field.label.includes("\n");
    return field.labelColor || twoLines
      ? { color: field.labelColor, whiteSpace: twoLines ? ("pre" as const) : undefined }
      : undefined;
  };
  // Several values written in one box under one label: 退火明細表's
  // 程式編號 is `＿ 第 ＿ 程式 ＿` (`joinNext`). Each keeps its own box, named
  // for a screen reader by its own label.
  const joinedBox = (parts: typeof section.fields) => {
    const host = parts[0]!;
    return (
      <Fragment key={host.key}>
        <th
          scope="row"
          className="cc-formsheet__rowlabel"
          colSpan={host.gridSpan?.label}
          style={labelStyle(host)}
        >
          {host.label}
        </th>
        <td colSpan={host.gridSpan?.value}>
          <span className="cc-formsheet__withunit cc-formsheet__joined">
            {parts.map((part) => (
              <Fragment key={part.key}>
                {part.prefix ? (
                  <span className="cc-formsheet__unit" aria-hidden="true">
                    {part.prefix}
                  </span>
                ) : null}
                <FormCell
                  field={part}
                  fieldKey={part.key}
                  label={part.accessibleLabel ?? part.label}
                  value={values.get(part.key) ?? ""}
                  editable={editable(part)}
                  onEdit={onEdit}
                  onBlur={onBlur}
                />
                {part.unit ? (
                  <span className="cc-formsheet__unit" aria-hidden="true">
                    {part.unit}
                  </span>
                ) : null}
              </Fragment>
            ))}
          </span>
        </td>
      </Fragment>
    );
  };
  const box = (parts: typeof section.fields) => {
          const field = parts[0]!;
          if (parts.length > 1) return joinedBox(parts);
          // Printed text in its own ruled cell — 加工製令單's KG and its
          // 製令單交給生產部 note. There is nothing to fill in after it.
          if (field.printedOnly) {
            return (
            <th
              key={field.key}
              className="cc-formsheet__rowlabel"
              scope="row"
              colSpan={field.gridSpan?.label}
              style={labelStyle(field)}
            >
              {field.label}
            </th>
            );
          }
          return (
            <Fragment key={field.key}>
              <th
                scope="row"
                className="cc-formsheet__rowlabel"
                colSpan={field.gridSpan?.label}
                style={labelStyle(field)}
              >
                {field.label}
              </th>
              <td colSpan={field.gridSpan?.value}>
                {/* Printed text inside the box itself: a unit such as KVA on
                    裁剪需求表, or 信太's leading B on 客戶單號. The operator
                    writes beside it. */}
                <span
                  className={field.unit || field.prefix ? "cc-formsheet__withunit" : undefined}
                >
                  {field.prefix ? (
                    <span className="cc-formsheet__unit" aria-hidden="true">
                      {field.prefix}
                    </span>
                  ) : null}
                  <FormCell
                    field={field}
                    fieldKey={field.key}
                    label={
                      field.unit
                        ? `${field.accessibleLabel ?? field.label}（${field.unit}）`
                        : (field.accessibleLabel ?? field.label)
                    }
                    value={values.get(field.key) ?? ""}
                    editable={editable(field)}
                    onEdit={onEdit}
                    onBlur={onBlur}
                  />
                  {field.unit ? (
                    <span className="cc-formsheet__unit" aria-hidden="true">
                      {field.unit}
                    </span>
                  ) : null}
                </span>
              </td>
            </Fragment>
          );
  };
  const cells = (fields: typeof section.fields, rowIndex: number) => (
    <>
        {fieldBoxes(fields).map(box)}
        {documentCode && rowIndex === last ? (
          <td className="cc-formsheet__doc" colSpan={2}>
            {documentCode}
          </td>
        ) : null}
    </>
  );
  const row = (fields: typeof section.fields, rowIndex: number) => (
    <tbody>
      <tr>{cells(fields, rowIndex)}</tr>
    </tbody>
  );

  // A header on the worksheet's own columns (加工製令單 version 2, the user,
  // 2026-10-02): one table, so every row's labels and boxes fall on the same
  // columns and line up down the band as they do on the paper.
  if (section.fieldGrid) {
    const total = section.fieldGrid.reduce((sum, width) => sum + width, 0);
    const aside = section.asideDrawing;
    return (
      <table className="cc-formsheet__grid cc-formsheet__band cc-formsheet__band--grid">
        <caption className="cc-sr-only">{section.fields.map((f) => f.label).join("、")}</caption>
        <colgroup>
          {section.fieldGrid.map((width, index) => (
            <col key={index} style={{ width: `${((width / total) * 100).toFixed(3)}%` }} />
          ))}
        </colgroup>
        <tbody>
          {printedRows.map((fields, rowIndex) => (
            <tr key={fields[0]?.key ?? rowIndex}>
              {cells(fields, rowIndex)}
              {/* A drawing beside the fields, down to the band's end: the
                  A–D views beside 出貨數量 on 特性檢驗報告單. */}
              {aside && rowIndex + 1 === aside.startRow ? (
                <td
                  className="cc-formsheet__fieldaside"
                  colSpan={aside.columns}
                  rowSpan={printedRows.length - aside.startRow + 1}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- fixed
                      printed drawing, not user content. */}
                  <img src={aside.asset} alt={aside.alt} />
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  // A band left to one row splits its width evenly; one whose definition
  // names its row sizes each cell to its words, as the wrapped bands below
  // do — 沖壓's 上班 line needs the room for five boxes.
  if (printedRows.length === 1 && !section.fieldRows) {
    return (
      <table className="cc-formsheet__grid cc-formsheet__band">
        <caption className="cc-sr-only">{section.fields.map((f) => f.label).join("、")}</caption>
        {row(printedRows[0]!, 0)}
      </table>
    );
  }

  /*
   * One table per printed row.
   *
   * A header the paper wraps does not divide each row at the same places, and
   * the worksheet merges cells so every row splits where it likes. Sharing one
   * table's columns makes the longest label anywhere set a width everywhere —
   * on 加工製令單 that squeezed 交期's write-on cell to twelve pixels. Stacked
   * bands already collapse into one printed box, so each row sizes to its own
   * words instead.
   */
  return (
    <>
      {printedRows.map((fields, rowIndex) => (
        <table
          key={fields[0]?.key ?? rowIndex}
          className="cc-formsheet__grid cc-formsheet__band cc-formsheet__band--wrapped"
        >
          <caption className="cc-sr-only">
            {fields.map((field) => field.label).join("、")}
          </caption>
          {row(fields, rowIndex)}
        </table>
      ))}
    </>
  );
}

/**
 * One writable cell. A field whose printed box takes several lines — 材料寬度
 * when the coils differ — is a textarea that grows, because the operator writes
 * one value per line rather than one value per column.
 */
export function FormCell({
  field,
  fieldKey,
  label,
  value,
  editable,
  onEdit,
  onBlur,
}: {
  field: {
    type: string;
    multiline: boolean;
    lines?: number | undefined;
    choices?: string[] | undefined;
    choiceWriteIn?: string | undefined;
    choiceWriteInSeparator?: string | undefined;
    choiceWriteInUnit?: string | undefined;
  };
  fieldKey: string;
  label: string;
  value: string;
  editable: boolean;
  onEdit: (key: string, value: string) => void;
  onBlur: () => void;
}) {
  if (field.choices) {
    // Printed boxes to tick, □OK □NG on CUT成品檢查表. Ticking the ticked
    // box again clears it, as crossing it out would on paper.
    const writeIn = field.choiceWriteIn;
    const ticked = readChoice(value, writeIn);
    return (
      <span
        role="radiogroup"
        aria-label={label}
        className={`cc-formsheet__choices${writeIn ? " cc-formsheet__choices--writein" : ""}`}
      >
        {field.choices.map((choice) => (
          <Fragment key={choice}>
            <label className="cc-formsheet__choice">
              <input
                type="radio"
                name={fieldKey}
                value={choice}
                checked={ticked.choice === choice}
                disabled={!editable}
                // Ticking the write-in box keeps what is already written.
                onChange={() =>
                  onEdit(fieldKey, choice === writeIn && ticked.text ? `${choice}：${ticked.text}` : choice)
                }
                onClick={() => {
                  if (ticked.choice === choice) onEdit(fieldKey, "");
                }}
                onBlur={onBlur}
              />
              {choice}
            </label>
            {choice === writeIn ? (
              // 產品需求表's `□其他：＿＿`, 生產日報表's `□請假 ＿H`: writing on
              // the line ticks the box it follows, and clearing the line
              // leaves the box ticked.
              <span className="cc-formsheet__writein">
                <span aria-hidden="true">{field.choiceWriteInSeparator ?? "："}</span>
                <input
                  className="cc-formsheet__cell"
                  aria-label={`${label} ${choice}`}
                  value={ticked.choice === choice ? ticked.text : ""}
                  readOnly={!editable}
                  onChange={(event) => onEdit(fieldKey, `${choice}：${event.target.value}`)}
                  onBlur={onBlur}
                />
                {field.choiceWriteInUnit ? (
                  <span aria-hidden="true">{field.choiceWriteInUnit}</span>
                ) : null}
              </span>
            ) : null}
          </Fragment>
        ))}
      </span>
    );
  }
  if (field.multiline) {
    return (
      <textarea
        className="cc-formsheet__cell"
        aria-label={label}
        rows={field.lines ?? 1}
        value={value}
        readOnly={!editable}
        onChange={(event) => onEdit(fieldKey, event.target.value)}
        onBlur={onBlur}
      />
    );
  }
  return (
    <input
      className="cc-formsheet__cell"
      type={field.type === "DATE" ? "date" : "text"}
      aria-label={label}
      value={value}
      readOnly={!editable}
      onChange={(event) => onEdit(fieldKey, event.target.value)}
      onBlur={onBlur}
    />
  );
}

/**
 * Fixed printed rows against fixed printed columns. Group labels run down the
 * left with row spans, and any printed 標準值 is read-only — it is form content,
 * not data, so it must never be typed into.
 */
export function MatrixBand({
  section,
  values,
  editable,
  onEdit,
  onBlur,
}: BandProps<Extract<TemplateSection, { type: "MATRIX" }>>) {
  const hasStandards = section.groups.some((group) =>
    group.rows.some((row) => row.standardValue !== null && row.standardValue !== ""),
  );
  const hasGroupLabels = section.groups.some((group) => group.label !== null);
  // Source proportions, row labels first. A group column or a 標準值 column
  // would shift every later column out of position, so widths apply only to
  // the plain shape 加工製令單 prints.
  const widths =
    section.columnWidthUnits && !hasStandards && !hasGroupLabels
      ? section.columnWidthUnits
      : null;
  const widthTotal = widths?.reduce((sum, width) => sum + width, 0) ?? 0;

  return (
    <table
      className={`cc-formsheet__grid cc-formsheet__band${widths ? " cc-formsheet__band--sized" : ""}`}
      style={{ minWidth: 900 }}
    >
      <caption className="cc-sr-only">{section.label}</caption>
      {widths ? (
        <colgroup>
          {widths.map((width, index) => (
            <col key={index} style={{ width: `${(width / widthTotal) * 100}%` }} />
          ))}
        </colgroup>
      ) : null}
      {/*
        Two header rows when the block heading and the row-label heading differ,
        which is how 檢驗紀錄 is printed: 序 / 檢驗項目 / 檢驗紀錄 across the
        top, then 標準值 and the coil columns beneath it. One row otherwise.
      */}
      <thead>
        {section.rowLabelHeading ? (
          <tr>
            {hasGroupLabels ? (
              <th className="cc-formsheet__group" rowSpan={2}>
                {section.groupHeading ?? ""}
              </th>
            ) : null}
            <th className="cc-formsheet__rowlabel" rowSpan={2}>
              {section.rowLabelHeading}
            </th>
            <th
              className="cc-formsheet__rowlabel"
              colSpan={section.columns.length + (hasStandards ? 1 : 0)}
            >
              {section.label}
            </th>
          </tr>
        ) : null}
        <tr>
          {section.rowLabelHeading ? null : (
            <>
              {hasGroupLabels ? (
                <th className="cc-formsheet__group">{section.groupHeading ?? ""}</th>
              ) : null}
              <th className="cc-formsheet__rowlabel">{section.label}</th>
            </>
          )}
          {hasStandards ? <th className="cc-formsheet__standard">標準值</th> : null}
          {section.columns.map((column) => (
            <th className="cc-formsheet__rowlabel" key={column.key}>
              {column.label}
              {column.note ? (
                <small className="cc-formsheet__note">{column.note}</small>
              ) : null}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {section.groups.flatMap((group) =>
          group.rows.map((row, rowIndex) => (
            <tr key={`${group.key}-${row.key}`}>
              {hasGroupLabels && rowIndex === 0 ? (
                <th className="cc-formsheet__group" rowSpan={group.rows.length}>
                  {group.label}
                </th>
              ) : null}
              <th className="cc-formsheet__rowlabel">{row.label}</th>
              {hasStandards ? (
                <td className="cc-formsheet__standard">{row.standardValue}</td>
              ) : null}
              {section.columns.map((column) => {
                const key = `${section.key}.${row.key}.${column.key}`;
                return (
                  <td key={column.key}>
                    <input
                      className="cc-formsheet__cell"
                      aria-label={`${column.label} ${row.label}`}
                      value={values.get(key) ?? ""}
                      readOnly={!editable(row)}
                      onChange={(event) => onEdit(key, event.target.value)}
                      onBlur={onBlur}
                    />
                  </td>
                );
              })}
            </tr>
          )),
        )}
      </tbody>
    </table>
  );
}

/** A numbered run printed across the form, e.g. 排刀情況 1–20. */
/**
 * A matrix printed as 首件/巡迴檢驗單 prints its two blocks: the block's name
 * down the left, 品質特性 over both label columns or a corner of 檢驗時間 over
 * 品質特性, headings that span (檢測值) or are written in (`＿日 ＿時 ＿分`),
 * rows ticked once across several columns, and a block beside the rows.
 *
 * One body, headings included, so the side label and the block beside can
 * run down the whole of it. Every matrix without these keeps MatrixBand.
 */
export function PrintedMatrixBand({
  section,
  values,
  editable,
  onEdit,
  onBlur,
}: BandProps<Extract<TemplateSection, { type: "MATRIX" }>>) {
  const groupLabels = section.groups.some((group) => group.label !== null);
  const labelSpan = groupLabels ? 2 : 1;
  // Groups the paper prints above the headings — 製令單號 and 規格 on 沖壓
  // and 平板剪's 製程檢驗 — then the headings, then the rest.
  const aboveGroups = section.groups.filter((group) => group.aboveHeading);
  const belowGroups = section.groups.filter((group) => !group.aboveHeading);
  const countRows = (groups: typeof section.groups) =>
    groups.reduce((sum, group) => sum + group.rows.length, 0);
  const bodyRows = countRows(belowGroups);
  const widths = section.columnWidthUnits;
  const widthTotal = widths?.reduce((sum, width) => sum + width, 0) ?? 0;
  const name = section.sideLabel ?? section.label;
  const entry = section.headingEntry;
  // The side label runs down the whole block, starting at its first row.
  const sideCell = section.sideLabel ? (
    <th
      scope="rowgroup"
      rowSpan={countRows(aboveGroups) + bodyRows + 1}
      className="cc-formsheet__sidelabel"
    >
      {section.sideLabel}
    </th>
  ) : null;

  const headings: ReactNode[] = [];
  for (let index = 0; index < section.columns.length; index += 1) {
    const column = section.columns[index]!;
    if (entry) {
      // Written in: when this round was checked.
      headings.push(
        <th scope="col" className="cc-formsheet__entryheading" key={column.key}>
          {entry.parts.map((part) => {
            const key = `${section.key}.${entry.field.key}.${column.key}.${part.key}`;
            return (
              <span className="cc-formsheet__entrypart" key={part.key}>
                <input
                  className="cc-formsheet__cell"
                  aria-label={`${name} ${column.label} ${entry.field.label} ${part.unit}`}
                  inputMode="numeric"
                  value={values.get(key) ?? ""}
                  readOnly={!editable(entry.field)}
                  onChange={(event) => onEdit(key, event.target.value)}
                  onBlur={onBlur}
                />
                <span aria-hidden="true">{part.unit}</span>
              </span>
            );
          })}
        </th>,
      );
      continue;
    }
    if (column.headingSpan) {
      headings.push(
        <th scope="colgroup" colSpan={column.headingSpan} key={column.key}>
          {column.heading}
        </th>,
      );
      index += column.headingSpan - 1;
      continue;
    }
    headings.push(
      <th scope="col" key={column.key}>
        {column.label}
      </th>,
    );
  }

  const renderRows = (groups: typeof section.groups, sideOnFirst: boolean) =>
    groups.flatMap((group, groupIndex) =>
      group.rows.map((row, rowIndex) => (
        <tr key={`${group.key}-${row.key}`}>
          {sideOnFirst && groupIndex === 0 && rowIndex === 0 ? sideCell : null}
          {group.label !== null && rowIndex === 0 ? (
            <th scope="rowgroup" rowSpan={group.rows.length} className="cc-formsheet__rowlabel">
              {group.label}
            </th>
          ) : null}
          <th
            scope="row"
            className="cc-formsheet__rowlabel"
            colSpan={groupLabels && group.label === null ? labelSpan : undefined}
          >
            {row.label}
          </th>
          {matrixRowCells(section, row).map(({ column, span, printed }) => {
            // 公差: printed on the form, never written.
            if (printed) {
              return (
                <td key={column.key} className="cc-formsheet__standard">
                  {row.standardValue}
                </td>
              );
            }
            const key = `${section.key}.${row.key}.${column.key}`;
            // One cell across several columns is named by its row alone.
            const label = span > 1 ? `${name} ${row.label}` : `${name} ${row.label} ${column.label}`;
            const choices = matrixCellChoices(column, row);
            const unit = row.cellUnits?.[column.key];
            return (
              <td key={column.key} colSpan={span > 1 ? span : undefined}>
                {choices ? (
                  <span className="cc-formsheet__withunit">
                    {!column.choices && row.prefix ? (
                      <span className="cc-formsheet__unit" aria-hidden="true">
                        {row.prefix}
                      </span>
                    ) : null}
                    <FormCell
                      field={{ ...row, choices, choiceWriteIn: undefined }}
                      fieldKey={key}
                      label={label}
                      value={values.get(key) ?? ""}
                      editable={editable(row)}
                      onEdit={onEdit}
                      onBlur={onBlur}
                    />
                  </span>
                ) : (
                  <span className={unit ? "cc-formsheet__withunit" : undefined}>
                    <input
                      className="cc-formsheet__cell"
                      aria-label={unit ? `${label}（${unit}）` : label}
                      value={values.get(key) ?? ""}
                      readOnly={!editable(row)}
                      onChange={(event) => onEdit(key, event.target.value)}
                      onBlur={onBlur}
                    />
                    {unit ? (
                      <span className="cc-formsheet__unit" aria-hidden="true">
                        {unit}
                      </span>
                    ) : null}
                  </span>
                )}
              </td>
            );
          })}
        </tr>
      )),
    );

  return (
    <table
      className="cc-formsheet__grid cc-formsheet__band cc-formsheet__printedmatrix"
      style={{ minWidth: 960 }}
    >
      <caption className="cc-sr-only">{section.label}</caption>
      {widths ? (
        <colgroup>
          {widths.map((width, index) => (
            <col key={index} style={{ width: `${(width / widthTotal) * 100}%` }} />
          ))}
        </colgroup>
      ) : null}
      <tbody>
        {renderRows(aboveGroups, true)}
        <tr>
          {aboveGroups.length === 0 ? sideCell : null}
          {section.cornerCell ? (
            <th scope="col" colSpan={labelSpan} className="cc-formsheet__corner">
              <span className="cc-formsheet__corner-across">{section.cornerCell.across}</span>
              <span className="cc-formsheet__corner-down">{section.cornerCell.down}</span>
            </th>
          ) : (
            <th scope="col" colSpan={labelSpan}>
              {section.rowLabelHeading ?? section.label}
            </th>
          )}
          {headings}
          {section.aside ? (
            <td rowSpan={bodyRows + 1} className="cc-formsheet__aside">
              {/* 類型, ticked, over the drawings; the note at the foot, so the
                  drawing takes the room between (the user, 2026-10-02). */}
              <div className="cc-formsheet__aside-fill">
              <div className="cc-formsheet__aside-choice">
                <span aria-hidden="true">{section.aside.field.label}：</span>
                <FormCell
                  field={section.aside.field}
                  fieldKey={section.aside.field.key}
                  label={section.aside.field.label}
                  value={values.get(section.aside.field.key) ?? ""}
                  editable={editable(section.aside.field)}
                  onEdit={onEdit}
                  onBlur={onBlur}
                />
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element -- fixed
                  printed drawing, not user content. */}
              <img src={section.aside.drawing.asset} alt={section.aside.drawing.alt} />
              {section.aside.note ? (
                <p className="cc-formsheet__aside-note">{section.aside.note}</p>
              ) : null}
              </div>
            </td>
          ) : null}
        </tr>
        {renderRows(belowGroups, false)}
      </tbody>
    </table>
  );
}

export function NumberedGridBand({
  section,
  values,
  editable,
  onEdit,
  onBlur,
}: BandProps<Extract<TemplateSection, { type: "NUMBERED_GRID" }>>) {
  const columns = Array.from({ length: section.columnCount }, (_, i) => i);
  const rows = Array.from({ length: section.rowCount }, (_, i) => i);
  return (
    <>
      <div className="cc-formsheet__band">
        <p className="cc-formsheet__caption">{section.label}：</p>
      </div>
      <table className="cc-formsheet__grid cc-formsheet__band" style={{ minWidth: 900 }}>
        <caption className="cc-sr-only">{section.label}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th className="cc-formsheet__rowlabel" key={column}>
                {/* 條料入庫 prints （1）…（9); everything else is plain. */}
                {section.columnLabels?.[column] ?? column + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row}>
              {columns.map((column) => {
                const key = `${section.key}.${row}.${column}`;
                return (
                  <td key={column}>
                    <input
                      className="cc-formsheet__cell"
                      aria-label={`${section.label} ${
                        section.columnLabels?.[column] ?? `第 ${column + 1} 格`
                      } 第 ${row + 1} 列`}
                      value={values.get(key) ?? ""}
                      readOnly={!editable(section.cell)}
                      onChange={(event) => onEdit(key, event.target.value)}
                      onBlur={onBlur}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/**
 * Numbered write-on blanks in the printed grid — 領料鋼捲號 １–９ across three
 * columns, followed by the unnumbered fourth row the form prints for
 * continuation. Cells past `count` are drawn without a number, as on paper.
 */
export function NumberedBlanksBand({
  section,
  values,
  editable,
  onEdit,
  onBlur,
}: BandProps<Extract<TemplateSection, { type: "NUMBERED_BLANKS" }>>) {
  const cells = Array.from({ length: section.columns * section.rows }, (_, i) => i);
  // Numbered down each column first where the paper does: 1–6 down the left,
  // 7–12 down the right on 沖壓's 生產日報表.
  const down = section.order === "DOWN";
  return (
    <div className="cc-formsheet__band">
      {/* The back of a sheet is headed 背面 by its own box, not captioned. */}
      {section.printedOnBack ? null : (
        <p className="cc-formsheet__caption">{section.label}：</p>
      )}
      <div
        className="cc-formsheet__blanks"
        style={{
          gridTemplateColumns: `repeat(${section.columns}, minmax(0, 1fr))`,
          ...(down
            ? { gridTemplateRows: `repeat(${section.rows}, auto)`, gridAutoFlow: "column" }
            : {}),
        }}
      >
        {cells.map((index) => {
          const key = `${section.key}.${index}`;
          const numbered = index < section.count;
          return (
            <label className="cc-formsheet__blank" key={index}>
              {numbered ? index + 1 : <span aria-hidden="true">&nbsp;</span>}
              <input
                aria-label={
                  numbered
                    ? `${section.label} ${index + 1}`
                    : `${section.label} 續填 ${index - section.count + 1}`
                }
                value={values.get(key) ?? ""}
                readOnly={!editable(section.entry)}
                onChange={(event) => onEdit(key, event.target.value)}
                onBlur={onBlur}
              />
            </label>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The printed illustration band — 積鐵芯疊法 on 裁剪需求表.
 *
 * Part of the form rather than data: there is nothing to fill in, and the
 * operator reads it while filling the grid above. The pictures are served from
 * the application here; the PDF renderer inlines the same files instead,
 * because it is not allowed to fetch anything (packages/sheet-document).
 */
export function DiagramsBand({
  section,
}: {
  section: Extract<TemplateSection, { type: "DIAGRAMS" }>;
}) {
  return (
    <div className="cc-formsheet__band">
      <p className="cc-formsheet__caption">{section.label}</p>
      <div
        className="cc-formsheet__diagrams"
        style={{ ["--cc-diagram-count" as string]: section.items.length }}
      >
        {section.items.map((item) => (
          <figure className="cc-formsheet__diagram" key={item.key}>
            <figcaption>{item.label}</figcaption>
            {/* eslint-disable-next-line @next/next/no-img-element -- a fixed
                printed drawing, not user content: no loader, no sizing. */}
            <img src={item.asset} alt={item.alt} />
          </figure>
        ))}
      </div>
    </div>
  );
}

/**
 * Printed reference closing the form: CUT成品檢查表's core views beside its
 * 公差 table, or 特性檢驗報告單's views alone. Nothing here is written in.
 */
export function ReferenceBand({
  section,
  values,
  editable,
  onEdit,
  onBlur,
}: {
  section: Extract<TemplateSection, { type: "REFERENCE_BAND" }>;
} & Partial<Omit<BandProps<unknown>, "section">>) {
  const { table } = section;
  const entry = section.entry;
  return (
    <div
      className={`cc-formsheet__reference${table ? "" : " cc-formsheet__reference--drawing"}`}
      role="group"
      aria-label={section.label}
    >
      {section.drawing ? (
        <div className="cc-formsheet__reference-drawing">
          {/* eslint-disable-next-line @next/next/no-img-element -- fixed
              printed drawing, not user content. */}
          <img src={section.drawing.asset} alt={section.drawing.alt} />
        </div>
      ) : null}
      {table ? (
        <table className="cc-formsheet__reference-table">
          <caption className="cc-sr-only">{section.label}</caption>
          <thead>
            <tr>
              <th scope="col" className="cc-formsheet__corner">
                <span className="cc-formsheet__corner-across">{table.corner.across}</span>
                <span className="cc-formsheet__corner-down">{table.corner.down}</span>
              </th>
              {table.columns.map((column) => (
                <th scope="col" key={column.label}>
                  {column.label}
                  {column.note ? <small>{column.note}</small> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {row.values.map((value, index) => (
                  <td key={table.columns[index]?.label ?? index}>{value}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {entry && values && editable && onEdit && onBlur ? (
        // 鋼捲號：, and room under it for several numbers.
        <label className="cc-formsheet__reference-entry">
          <span>{entry.label}：</span>
          <textarea
            className="cc-formsheet__cell"
            rows={4}
            value={values.get(entry.key) ?? ""}
            readOnly={!editable(entry)}
            onChange={(event) => onEdit(entry.key, event.target.value)}
            onBlur={onBlur}
          />
        </label>
      ) : null}
    </div>
  );
}

/**
 * One printed signature pair: the role label in a narrow cell and the space
 * beside it. Rendered as two cells so the band matches the paper rather than
 * aligning to the data columns above, which the printed form does not do
 * either.
 *
 * On a reviewed form the space carries who signed it and when (the user,
 * 2026-10-01): the name the PDF prints in the same box.
 */
export function SignatureCells({
  label,
  signature,
}: {
  label: string;
  signature?: { displayName: string; decidedAt: string | null } | undefined;
}) {
  return (
    <>
      <div className="cc-formsheet__sign">{label}</div>
      <div className="cc-formsheet__signspace">
        {signature ? (
          <>
            <span className="cc-sr-only">{label} 簽核欄：</span>
            <span className="cc-formsheet__signname">{signature.displayName}</span>
            {signature.decidedAt ? (
              <span className="cc-formsheet__signtime cc-tnum">{signature.decidedAt}</span>
            ) : null}
          </>
        ) : (
          <span className="cc-sr-only">{label} 簽核欄，尚未簽核</span>
        )}
      </div>
    </>
  );
}
