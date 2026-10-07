import { DIAGRAM_DATA_URIS } from "./diagram-assets.js";
import { documentStyles } from "./document-styles.js";
import {
  formatChoices,
  isPrintedMatrix,
  matrixCellChoices,
  matrixRowCells,
  headingRows,
  isRowCornerCell,
  isRowGroupContinuation,
  printedCells,
  printedRowNumber,
  resolveComputedValue,
  resolveDocumentIdentifier,
  fieldBoxes,
  resolveFieldRows,
  resolveTemplateHeaderLayout,
  resolveTemplatePrintLayout,
  type SheetState,
  type SheetTemplateDefinition,
  type TemplateHeaderLayout,
  type TemplatePrintLayout,
} from "@workflow/contracts";

type TemplateSection = SheetTemplateDefinition["sections"][number];
export type SignatureRole =
  | "ORIGIN_MANAGER"
  | "SALES"
  | "ASSOCIATE"
  | "GENERAL_MANAGER";

export type SheetSignature = {
  displayName: string;
  decidedAt: string | null;
};

export type SheetDocumentModel = {
  definition: SheetTemplateDefinition;
  values: Map<string, string>;
  headerSection: Extract<TemplateSection, { type: "FIELDS" }> | undefined;
  rowSection: Extract<TemplateSection, { type: "FIXED_ROWS" }> | undefined;
  approvalSection:
    | Extract<TemplateSection, { type: "APPROVAL_STATUS" }>
    | undefined;
  headerLayout: TemplateHeaderLayout;
  printLayout: TemplatePrintLayout;
  fieldsInHeader: boolean;
  documentAtTop: boolean;
  documentBelowGrid: boolean;
  signatures: Partial<Record<SignatureRole, SheetSignature>>;
};

export const PDF_WATERMARK_LABEL: Partial<Record<SheetState, string>> = {
  DRAFT: "草稿",
  PENDING_SALES: "待業務審核",
  PENDING_ASSOCIATE: "待協理審核",
  PENDING_GENERAL_MANAGER: "待總經理審核",
  READY: "待生產",
  ASSIGNED: "已指派",
  IN_PROGRESS: "生產中",
  RETURNED: "已退回",
};

export function flattenSheetValues(values: Record<string, unknown>): Map<string, string> {
  const flat = new Map<string, string>();
  const walk = (node: unknown, path: string): void => {
    if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
      flat.set(path, String(node));
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((child, index) => walk(child, path ? `${path}.${index}` : String(index)));
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        walk(child, path ? `${path}.${key}` : key);
      }
    }
  };
  walk(values, "");
  return flat;
}

export function buildSheetDocumentModel(
  definition: SheetTemplateDefinition,
  values: Record<string, unknown> | Map<string, string>,
  signatures: Partial<Record<SignatureRole, SheetSignature>> = {},
): SheetDocumentModel {
  const headerLayout = resolveTemplateHeaderLayout(definition);
  return {
    definition,
    values: values instanceof Map ? values : flattenSheetValues(values),
    headerSection: definition.sections.find(
      (section): section is Extract<TemplateSection, { type: "FIELDS" }> =>
        section.type === "FIELDS",
    ),
    rowSection: definition.sections.find(
      (section): section is Extract<TemplateSection, { type: "FIXED_ROWS" }> =>
        section.type === "FIXED_ROWS",
    ),
    approvalSection: definition.sections.find(
      (section): section is Extract<TemplateSection, { type: "APPROVAL_STATUS" }> =>
        section.type === "APPROVAL_STATUS",
    ),
    headerLayout,
    printLayout: resolveTemplatePrintLayout(definition),
    fieldsInHeader: headerLayout !== "TITLE_ONLY",
    documentAtTop: definition.documentCodePosition === "TOP_RIGHT",
    documentBelowGrid: definition.documentCodePosition === "BELOW_GRID_RIGHT",
    signatures,
  };
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function cell(value: string | undefined, className = "value"): string {
  return `<div class="${className}">${escapeHtml(value ?? "")}</div>`;
}

function renderFields(
  section: Extract<TemplateSection, { type: "FIELDS" }>,
  model: SheetDocumentModel,
  documentCode: string | null,
): string {
  const doc = documentCode
    ? `<td class="document-code" colspan="2">${escapeHtml(documentCode)}</td>`
    : "";
  const printedRows = resolveFieldRows(section);
  const last = printedRows.length - 1;
  // A label the paper sets in red, as 信太 prints 檢驗日期.
  // On a header with the worksheet's columns, each label and box spans its own.
  const span = (count: number | undefined) => (count && count > 1 ? ` colspan="${count}"` : "");
  const label = (field: (typeof section.fields)[number]) =>
    `<th${span(field.gridSpan?.label)}${field.labelColor ? ` style="color:${escapeHtml(field.labelColor)}"` : ""}>${escapeHtml(field.label)}</th>`;
  const box = (field: (typeof section.fields)[number]) => `<td${span(field.gridSpan?.value)}>`;
  const unitSpan = (text: string | undefined) =>
    text ? `<span class="unit">${escapeHtml(text)}</span>` : "";
  const boxFor = (parts: typeof section.fields): string => {
        const field = parts[0]!;
        // Several values written in one box under one label: 退火明細表's
        // 程式編號 is `＿ 第 ＿ 程式 ＿`.
        if (parts.length > 1) {
          const written = parts
            .map((part) => `${unitSpan(part.prefix)}${cell(model.values.get(part.key), "value")}${unitSpan(part.unit)}`)
            .join("");
          return `${label(field)}${box(field)}<div class="withunit joined">${written}</div></td>`;
        }
        if (field.printedOnly) return label(field);
        // Boxes to tick, printed with the ticked one filled.
        if (field.choices) {
          return `${label(field)}${box(field)}${cell(formatChoices(field.choices, model.values.get(field.key), field.choicesSeparator, field.choiceWriteIn, { separator: field.choiceWriteInSeparator, unit: field.choiceWriteInUnit }), "value choices")}</td>`;
        }
        const value = cell(model.values.get(field.key), field.multiline ? "value multiline" : "value");
        // Printed text before or after the value, inside its cell: 客戶單號's
        // leading B, or a unit such as KVA.
        return field.unit || field.prefix
          ? `${label(field)}${box(field)}<div class="withunit">${field.prefix ? `<span class="unit">${escapeHtml(field.prefix)}</span>` : ""}${value}${field.unit ? `<span class="unit">${escapeHtml(field.unit)}</span>` : ""}</div></td>`
          : `${label(field)}${box(field)}${value}</td>`;
  };
  const cellsFor = (fields: typeof section.fields, withDoc: boolean) =>
    fieldBoxes(fields)
      .map(boxFor)
      .join("") + (withDoc ? doc : "");

  // A header on the worksheet's own columns (加工製令單 version 2, the user,
  // 2026-10-02): one table, so labels and boxes line up from row to row.
  if (section.fieldGrid) {
    const total = section.fieldGrid.reduce((sum, width) => sum + width, 0);
    const cols = section.fieldGrid
      .map((width) => `<col style="width:${((width / total) * 100).toFixed(3)}%">`)
      .join("");
    // A drawing beside the fields, from its row to the band's end.
    const aside = section.asideDrawing;
    const asideCell = (rowIndex: number) =>
      aside && rowIndex + 1 === aside.startRow
        ? `<td class="fieldaside"${span(aside.columns)} rowspan="${printedRows.length - aside.startRow + 1}">${DIAGRAM_DATA_URIS[aside.asset] ? `<img src="${DIAGRAM_DATA_URIS[aside.asset]}" alt="${escapeHtml(aside.alt)}" />` : ""}</td>`
        : "";
    const rows = printedRows
      .map((fields, rowIndex) => `<tr>${cellsFor(fields, rowIndex === last)}${asideCell(rowIndex)}</tr>`)
      .join("");
    return `<table class="grid band fields-grid"><colgroup>${cols}</colgroup><tbody>${rows}</tbody></table>`;
  }

  // A band left to one row splits its width evenly; one whose definition
  // names its row sizes each cell to its words, as a wrapped band does —
  // 沖壓's 上班 line needs the room for five boxes.
  if (printedRows.length === 1 && !section.fieldRows) {
    return `<table class="grid band"><tbody><tr>${cellsFor(printedRows[0]!, true)}</tr></tbody></table>`;
  }

  // One table per printed row.
  //
  // A header the paper wraps does not divide each row at the same places:
  // 加工製令單 puts four pairs on its first row and one on its 備註 row, and
  // the worksheet merges cells to let every row split where it likes. Sharing
  // one table's columns across all of them makes the longest label in any row
  // set a column width for every other row — on that form it squeezed 交期's
  // write-on cell to twelve pixels. Stacked tables collapse into one printed
  // box through the band rule, so each row sizes itself to its own words.
  return printedRows
    .map(
      (fields, rowIndex) =>
        `<table class="grid band fields-wrapped"><tbody><tr>${cellsFor(fields, rowIndex === last)}</tr></tbody></table>`,
    )
    .join("");
}

/** A cell the worksheet fills with its own colour. */
function fillStyle(fill: string | undefined): string {
  return fill === undefined ? "" : ` style="background-color:${escapeHtml(fill)}"`;
}


function renderFixedRows(
  section: Extract<TemplateSection, { type: "FIXED_ROWS" }>,
  model: SheetDocumentModel,
): string {
  // A form whose first column is data, not a serial number, prints no
  // number column at all — see the schema's `rowNumbers`.
  const numbered = section.rowNumbers;
  // Row groups number each block instead, outside the box: 生產日報表 prints
  // its people 1 to 8 down the left of their rows.
  const groups = section.rowGroups;
  const groupNumbers = groups?.numbered ?? false;
  const lead = numbered || groupNumbers;
  const standard = section.standardRow;
  // Side-by-side blocks repeat the whole register across the page: 巧力 prints
  // 序 1–5 beside 6–10.
  const blockCount = section.blocks?.count ?? 1;
  const blockRows = section.rowCount / blockCount;
  const leadUnits = numbered ? section.rowNumberWidthUnits : groups?.numberWidthUnits;
  const blockUnits = !section.columnWidthUnits
    ? null
    : lead
      ? leadUnits !== undefined
        ? [leadUnits, ...section.columnWidthUnits]
        : null
      : [...section.columnWidthUnits];
  // A gap between blocks only where the paper leaves one: 巧力 does, 退火明細表
  // sets its two blocks edge to edge.
  const gapUnits = section.blocks?.gapUnits;
  const units = blockUnits
    ? Array.from({ length: blockCount }, (_, block) =>
        block > 0 && gapUnits !== undefined ? [gapUnits, ...blockUnits] : blockUnits,
      ).flat()
    : null;
  const total = units?.reduce((sum, width) => sum + width, 0) ?? 0;
  const cols = units
    ? `<colgroup>${units.map((width) => `<col style="width:${(width / total) * 100}%">`).join("")}</colgroup>`
    : "";
  // Columns that share a printed cell count once.
  const cells = printedCells(section);
  const blockSpan = cells.length + (lead ? 1 : 0);
  const span = blockSpan * blockCount + (gapUnits !== undefined ? blockCount - 1 : 0);
  const gap = gapUnits !== undefined ? `<td class="block-gap"></td>` : "";

  // The printed corner beside the headings and the standard row: 標準值 over
  // 測試值, or 位置 over 標準值. It stands in the number column when there is
  // one, otherwise in place of the first column's heading.
  const corner = standard
    ? `<th class="corner" rowspan="2"><span class="across">${escapeHtml(standard.corner.across)}</span><span class="down">${escapeHtml(standard.corner.down)}</span></th>`
    : "";
  const grouped = section.headingGroups !== undefined;
  const numberHeading = standard && numbered
    ? corner
    : numbered
      ? `<th class="number"${grouped ? ' rowspan="2"' : ""}>${escapeHtml(section.rowNumberLabel)}</th>`
      : groupNumbers
        ? `<th class="group-number"></th>`
        : "";
  // 外觀尺寸, with 單位: mm to its right, ruled inside the box above the
  // column headings.
  const caption = section.caption
    ? `<tr><th class="caption-row" colspan="${span}"><span class="caption-text">${escapeHtml(section.caption.text)}</span>${section.caption.note ? `<span class="caption-note">${escapeHtml(section.caption.note)}</span>` : ""}</th></tr>`
    : "";
  const headingCells = section.columns
    .map((column, index) => {
      if (standard && !numbered && index === 0) return corner;
      return column.spacer
        ? `<th class="spacer"></th>`
        : `<th${column.headingSmall ? ` class="small"` : ""}${fillStyle(column.headingFill)}>${escapeHtml(column.label)}</th>`;
    })
    .join("");
  const headingBlock = `${numberHeading}${headingCells}`;
  // Where the standard shares its heading's tall cell, no line divides them.
  const headingClass = standard && !standard.ruled ? ' class="joined"' : "";
  // Grouped headings: 不良品 over C級 D級 報廢, and 箱重/箱數 one tall cell
  // over its E and I cells. Plain registers only, so no blocks or corner.
  const groupedHeading = () => {
    const [first, second] = headingRows(section);
    const th = (heading: NonNullable<typeof first>[number]) =>
      `<th${heading.cells > 1 ? ` colspan="${heading.cells}"` : ""}${heading.rows > 1 ? ' rowspan="2"' : ""}${heading.column?.headingSmall ? ' class="small"' : ""}${fillStyle(heading.column?.headingFill)}>${escapeHtml(heading.label)}</th>`;
    return `<tr>${numberHeading}${first!.map(th).join("")}</tr><tr>${second!.map(th).join("")}</tr>`;
  };
  const heading = grouped
    ? groupedHeading()
    : `${caption}<tr${headingClass}>${Array.from({ length: blockCount }, () => headingBlock).join(gap)}</tr>`;

  const valueCell = (
    column: (typeof section.columns)[number],
    raw: string | undefined,
    read: (key: string) => string | undefined,
  ) => {
    if (column.computed) {
      return `<div class="value">${escapeHtml(resolveComputedValue(column.computed, read))}</div>`;
    }
    // Boxes to tick, printed with the ticked one filled.
    if (column.choices) {
      return cell(formatChoices(column.choices, raw, column.choicesSeparator, column.choiceWriteIn, { separator: column.choiceWriteInSeparator, unit: column.choiceWriteInUnit }), "value choices");
    }
    // A unit printed in the cell after the value: mA, W.
    if (column.unit) {
      return `<div class="withunit">${cell(raw)}<span class="unit">${escapeHtml(column.unit)}</span></div>`;
    }
    // A cell the paper writes on several lines keeps room for each: 士電's 品名.
    if (column.multiline && column.lines) {
      return `<div class="value multiline" style="min-height:${column.lines * 4.5}mm">${escapeHtml(raw ?? "")}</div>`;
    }
    return cell(raw);
  };

  const dataCells = (rowIndex: number) => {
    const read = (key: string) =>
      model.values.get(`${section.key}.${rowIndex}.${key}`);
    return cells
      .map(({ columns: parts, layout }) => {
        if (layout) {
          // One printed cell, several values: `E: ＿K* ＿箱` side by side,
          // or `E: ＿K` over `I: ＿K`.
          const printed = parts
            .map(
              (part) =>
                `<div class="part">${part.prefix ? `<span class="unit">${escapeHtml(part.prefix)}</span>` : ""}${cell(read(part.key))}${part.unit ? `<span class="unit">${escapeHtml(part.unit)}</span>` : ""}</div>`,
            )
            .join("");
          return `<td class="shared ${layout.toLowerCase()}">${printed}</td>`;
        }
        const column = parts[0]!;
        // Covered by the block's spanning cell above it.
        if (isRowGroupContinuation(section, rowIndex, column.key)) return "";
        // Printed, ruled corner to corner: what the row across holds over the
        // line, what the column down holds under it.
        if (section.cornerCell && isRowCornerCell(section, rowIndex, column.key)) {
          return `<th class="corner"><span class="across">${escapeHtml(section.cornerCell.across)}</span><span class="down">${escapeHtml(section.cornerCell.down)}</span></th>`;
        }
        // Covered by a standard row's corner, which runs down from the heading.
        if (standard && isRowCornerCell(section, rowIndex, column.key)) return "";
        // The name written once down the side of a block of rows, upright
        // characters one under another as the paper has them.
        if (groups && column.key === groups.spanningColumnKey) {
          return `<td class="group-name" rowspan="${groups.size}">${cell(read(column.key))}</td>`;
        }
        // The gap the paper leaves between a form and a block printed beside
        // it: a real column, ruled nowhere and holding nothing.
        if (column.spacer) return `<td class="spacer"></td>`;
        // The paper rules some cells corner to corner; the class draws that
        // line. The heading above them is not ruled, only the writing cells.
        const classes = column.diagonalSplit ? ' class="diagonal"' : "";
        return `<td${classes}${fillStyle(column.cellFill)}>${valueCell(column, read(column.key), read)}</td>`;
      })
      .join("");
  };
  const numberCell = (rowIndex: number) =>
    numbered
      ? `<th class="number">${printedRowNumber(section, rowIndex)}</th>`
      : groups && groupNumbers && rowIndex % groups.size === 0
        ? `<th class="group-number" rowspan="${groups.size}">${rowIndex / groups.size + 1}</th>`
        : "";
  const renderRow = (rowIndex: number) => `<tr>${numberCell(rowIndex)}${dataCells(rowIndex)}</tr>`;

  // The standard, directly under the headings; its lead cell is the corner.
  const standardRow = standard
    ? `<tr class="standard${standard.ruled ? "" : " joined"}">${dataCells(0)}</tr>`
    : "";
  const first = standard ? 1 : 0;
  // One body per block, so a heavier rule can separate them and a page can
  // break between them — never through one person's rows.
  const body = groups
    ? Array.from({ length: section.rowCount / groups.size }, (_, group) => {
        const pageStart =
          groups.perPage !== undefined && group > 0 && group % groups.perPage === 0;
        const rows = Array.from({ length: groups.size }, (_, offset) =>
          renderRow(group * groups.size + offset),
        ).join("");
        return `<tbody class="group${pageStart ? " page-start" : ""}">${rows}</tbody>`;
      }).join("")
    : blockCount > 1
      ? `<tbody>${Array.from({ length: blockRows }, (_, printed) =>
          `<tr>${Array.from({ length: blockCount }, (_, block) => {
            const rowIndex = block * blockRows + printed;
            return `${numberCell(rowIndex)}${dataCells(rowIndex)}`;
          }).join(gap)}</tr>`,
        ).join("")}</tbody>`
      : `<tbody>${Array.from({ length: section.rowCount - first }, (_, offset) => renderRow(offset + first)).join("")}</tbody>`;
  // Printed text closing the register inside its box, across every column,
  // including the number column when there is one.
  const legend = section.legend
    ? `<tfoot><tr><td class="legend${section.legendAlign === "START" ? " start" : ""}" colspan="${span}">${escapeHtml(section.legend)}</td></tr></tfoot>`
    : "";
  const tableClass = `grid fixed-rows${groups ? " grouped" : ""}${blockCount > 1 ? " blocks" : ""}`;
  return `<table class="${tableClass}">${cols}<thead>${heading}${standardRow}</thead>${body}${legend}</table>`;
}

/**
 * A matrix in the printed layout 首件/巡迴檢驗單 brought: a label down the
 * left of the block, a heading over both label columns or a corner, headings
 * that span or are written in, rows ticked once across several columns, and
 * a block beside the rows.
 */
function renderPrintedMatrix(
  section: Extract<TemplateSection, { type: "MATRIX" }>,
  model: SheetDocumentModel,
): string {
  const groupLabels = section.groups.some((group) => group.label !== null);
  const labelSpan = groupLabels ? 2 : 1;
  // Groups printed above the headings — 製令單號 and 規格 on 沖壓 and 平板剪's
  // 製程檢驗 — then the headings, then the rest.
  const aboveGroups = section.groups.filter((group) => group.aboveHeading);
  const belowGroups = section.groups.filter((group) => !group.aboveHeading);
  const countRows = (groups: typeof section.groups) =>
    groups.reduce((sum, group) => sum + group.rows.length, 0);
  const bodyRows = countRows(belowGroups);
  const widths = section.columnWidthUnits;
  const total = widths?.reduce((sum, width) => sum + width, 0) ?? 0;
  const cols = widths
    ? `<colgroup>${widths.map((width) => `<col style="width:${(width / total) * 100}%">`).join("")}</colgroup>`
    : "";
  const read = (key: string) => model.values.get(key);
  // The side label runs down the whole block, starting at its first row.
  const side = section.sideLabel
    ? `<th class="side-label" rowspan="${countRows(aboveGroups) + bodyRows + 1}">${escapeHtml(section.sideLabel)}</th>`
    : "";
  const labelHeading = section.cornerCell
    ? `<th class="corner" colspan="${labelSpan}"><span class="across">${escapeHtml(section.cornerCell.across)}</span><span class="down">${escapeHtml(section.cornerCell.down)}</span></th>`
    : `<th colspan="${labelSpan}">${escapeHtml(section.rowLabelHeading ?? section.label)}</th>`;
  // Written-in headings print each part's value before its unit.
  const entry = section.headingEntry;
  const columnHeadings: string[] = [];
  for (let index = 0; index < section.columns.length; index += 1) {
    const column = section.columns[index]!;
    if (entry) {
      const parts = entry.parts
        .map(
          (part) =>
            `<span class="entry-part">${cell(read(`${section.key}.${entry.field.key}.${column.key}.${part.key}`))}<span class="unit">${escapeHtml(part.unit)}</span></span>`,
        )
        .join("");
      columnHeadings.push(`<th class="entry">${parts}</th>`);
      continue;
    }
    if (column.headingSpan) {
      columnHeadings.push(`<th colspan="${column.headingSpan}">${escapeHtml(column.heading ?? column.label)}</th>`);
      index += column.headingSpan - 1;
      continue;
    }
    columnHeadings.push(`<th>${escapeHtml(column.label)}</th>`);
  }
  const aside = section.aside
    ? `<td class="aside" rowspan="${bodyRows + 1}"><div class="aside-fill"><div class="aside-choice">${escapeHtml(section.aside.field.label)}：${escapeHtml(formatChoices(section.aside.field.choices ?? [], read(section.aside.field.key), section.aside.field.choicesSeparator))}</div>${DIAGRAM_DATA_URIS[section.aside.drawing.asset] ? `<img src="${DIAGRAM_DATA_URIS[section.aside.drawing.asset]}" alt="${escapeHtml(section.aside.drawing.alt)}" />` : ""}${section.aside.note ? `<div class="aside-note">${escapeHtml(section.aside.note)}</div>` : ""}</div></td>`
    : "";
  const heading = `<tr>${aboveGroups.length === 0 ? side : ""}${labelHeading}${columnHeadings.join("")}${aside}</tr>`;

  const renderRows = (groups: typeof section.groups, sideOnFirst: boolean) => groups
    .flatMap((group, groupIndex) =>
      group.rows.map((row, rowIndex) => {
        const lead = sideOnFirst && groupIndex === 0 && rowIndex === 0 ? side : "";
        const groupCell =
          group.label !== null
            ? rowIndex === 0
              ? `<th rowspan="${group.rows.length}">${escapeHtml(group.label)}</th>`
              : ""
            : "";
        // A group with no label prints its row's label across both columns.
        const label = `<th${groupLabels && group.label === null ? ` colspan="${labelSpan}"` : ""}>${escapeHtml(row.label)}</th>`;
        const cells = matrixRowCells(section, row)
          .map(({ column, span, printed: fixed }) => {
            // 公差: printed on the form, never written.
            if (fixed) return `<td class="printed">${escapeHtml(row.standardValue ?? "")}</td>`;
            const raw = read(`${section.key}.${row.key}.${column.key}`);
            const unit = row.cellUnits?.[column.key];
            let printed: string;
            if (column.choices) {
              printed =
                column.choicesPrint === "CHOSEN"
                  ? cell(raw, "value mark")
                  : cell(formatChoices(column.choices, raw), "value choices");
            } else if (matrixCellChoices(column, row)) {
              printed = `<div class="withunit">${row.prefix ? `<span class="unit">${escapeHtml(row.prefix)}</span>` : ""}${cell(formatChoices(row.choices ?? [], raw, row.choicesSeparator), "value choices")}</div>`;
            } else if (unit) {
              printed = `<div class="withunit">${cell(raw)}<span class="unit">${escapeHtml(unit)}</span></div>`;
            } else {
              printed = cell(raw);
            }
            return `<td${span > 1 ? ` colspan="${span}"` : ""}>${printed}</td>`;
          })
          .join("");
        return `<tr>${lead}${groupCell}${label}${cells}</tr>`;
      }),
    )
    .join("");
  const rows = renderRows(belowGroups, false);
  // One body, headings included: a cell running down the whole block — the
  // side label, the drawing — cannot cross from a table head into its body.
  return `<table class="grid band matrix printed">${cols}<tbody>${renderRows(aboveGroups, true)}${heading}${rows}</tbody></table>`;
}

function renderMatrix(
  section: Extract<TemplateSection, { type: "MATRIX" }>,
  model: SheetDocumentModel,
): string {
  if (isPrintedMatrix(section)) return renderPrintedMatrix(section, model);
  const standards = section.groups.some((group) =>
    group.rows.some((row) => Boolean(row.standardValue)),
  );
  // Row labels first, then one per data column — see the schema. Only a
  // matrix with no group column and no 標準值 column can be sized this way,
  // because those two would shift every later column out of position.
  const widths =
    section.columnWidthUnits &&
    !standards &&
    !section.groups.some((group) => group.label !== null)
      ? section.columnWidthUnits
      : null;
  const widthTotal = widths?.reduce((sum, width) => sum + width, 0) ?? 0;
  const cols = widths
    ? `<colgroup>${widths.map((width) => `<col style="width:${(width / widthTotal) * 100}%">`).join("")}</colgroup>`
    : "";
  const groupLabels = section.groups.some((group) => group.label !== null);
  const firstHeader = section.rowLabelHeading
    ? `<tr>${groupLabels ? `<th rowspan="2">${escapeHtml(section.groupHeading ?? "")}</th>` : ""}<th rowspan="2">${escapeHtml(section.rowLabelHeading)}</th><th colspan="${section.columns.length + (standards ? 1 : 0)}">${escapeHtml(section.label)}</th></tr>`
    : "";
  const secondHeader = `<tr>${section.rowLabelHeading ? "" : `${groupLabels ? `<th>${escapeHtml(section.groupHeading ?? "")}</th>` : ""}<th>${escapeHtml(section.label)}</th>`}${standards ? "<th>標準值</th>" : ""}${section.columns.map((column) => `<th>${escapeHtml(column.label)}${column.note ? `<small class="note">${escapeHtml(column.note)}</small>` : ""}</th>`).join("")}</tr>`;
  const rows = section.groups
    .flatMap((group) =>
      group.rows.map((row, rowIndex) => {
        const groupCell =
          groupLabels && rowIndex === 0
            ? `<th rowspan="${group.rows.length}">${escapeHtml(group.label ?? "")}</th>`
            : "";
        const values = section.columns
          .map((column) => `<td>${cell(model.values.get(`${section.key}.${row.key}.${column.key}`))}</td>`)
          .join("");
        return `<tr>${groupCell}<th>${escapeHtml(row.label)}</th>${standards ? `<td class="standard">${escapeHtml(row.standardValue ?? "")}</td>` : ""}${values}</tr>`;
      }),
    )
    .join("");
  return `<table class="grid band matrix">${cols}<thead>${firstHeader}${secondHeader}</thead><tbody>${rows}</tbody></table>`;
}

function renderNumberedGrid(
  section: Extract<TemplateSection, { type: "NUMBERED_GRID" }>,
  model: SheetDocumentModel,
): string {
  const columns = Array.from({ length: section.columnCount }, (_, index) => index);
  const header = columns
    .map((column) => `<th>${escapeHtml(section.columnLabels?.[column] ?? column + 1)}</th>`)
    .join("");
  const rows = Array.from({ length: section.rowCount }, (_, row) =>
    `<tr>${columns.map((column) => `<td>${cell(model.values.get(`${section.key}.${row}.${column}`))}</td>`).join("")}</tr>`,
  ).join("");
  return `<div class="caption">${escapeHtml(section.label)}：</div><table class="grid band numbered"><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`;
}

function renderNumberedBlanks(
  section: Extract<TemplateSection, { type: "NUMBERED_BLANKS" }>,
  model: SheetDocumentModel,
): string {
  const down = section.order === "DOWN";
  const cells = Array.from({ length: section.columns * section.rows }, (_, index) => {
    const number = index < section.count ? String(index + 1) : "&nbsp;";
    // Down the columns fills each column before the next: the grid flows by
    // column, so the index still counts from 1 in reading order of the paper.
    const column = down ? Math.floor(index / section.rows) : index % section.columns;
    const row = down ? index % section.rows : Math.floor(index / section.columns);
    const borders = `${column === section.columns - 1 ? "border-right:0;" : ""}${row === section.rows - 1 ? "border-bottom:0;" : ""}`;
    return `<div class="blank" style="${borders}"><span>${number}</span>${cell(model.values.get(`${section.key}.${index}`))}</div>`;
  }).join("");
  const layout = `grid-template-columns:repeat(${section.columns},minmax(0,1fr))${down ? `;grid-template-rows:repeat(${section.rows},auto);grid-auto-flow:column` : ""}`;
  // The back of the sheet prints on a page of its own, with no caption: the
  // paper's back is the spaces alone.
  if (section.printedOnBack) {
    return `<section class="back-side"><div class="blanks back" style="${layout}">${cells}</div></section>`;
  }
  return `<div class="caption">${escapeHtml(section.label)}：</div><div class="blanks" style="${layout}">${cells}</div>`;
}

/**
 * The printed illustration band, e.g. 積鐵芯疊法 on 裁剪需求表.
 *
 * The pictures are inlined as `data:` URIs rather than linked, because this
 * document is rendered with every network request aborted — see pdf.ts. A path
 * with no inlined copy prints its caption alone rather than a broken image, so
 * a forgotten regeneration loses the drawing and not the section.
 */
function renderDiagrams(
  section: Extract<TemplateSection, { type: "DIAGRAMS" }>,
): string {
  const items = section.items
    .map((item) => {
      const source = DIAGRAM_DATA_URIS[item.asset];
      const image = source
        ? `<img src="${source}" alt="${escapeHtml(item.alt)}" />`
        : "";
      return `<div class="diagram"><div class="diagram-label">${escapeHtml(item.label)}</div>${image}</div>`;
    })
    .join("");
  return `<div class="caption">${escapeHtml(section.label)}</div><div class="diagrams" style="grid-template-columns:repeat(${section.items.length},minmax(0,1fr))">${items}</div>`;
}

/**
 * The printed reference closing a form: CUT成品檢查表's core views beside its
 * 公差 table. A drawing is inlined like the DIAGRAMS pictures; the table is
 * text, so it prints sharp.
 */
function renderReferenceBand(
  section: Extract<TemplateSection, { type: "REFERENCE_BAND" }>,
  model: SheetDocumentModel,
): string {
  const source = section.drawing ? DIAGRAM_DATA_URIS[section.drawing.asset] : undefined;
  const drawing = section.drawing
    ? `<div class="reference-drawing">${source ? `<img src="${source}" alt="${escapeHtml(section.drawing.alt)}" />` : ""}</div>`
    : "";
  const { table } = section;
  // 鋼捲號：, and room to write under it, beside the table.
  const entry = section.entry
    ? `<div class="reference-entry"><div class="reference-entry-label">${escapeHtml(section.entry.label)}：</div>${cell(model.values.get(section.entry.key), "value multiline")}</div>`
    : "";
  if (!table) return `<div class="reference">${drawing}${entry}</div>`;
  const head = `<tr><th class="corner"><span class="across">${escapeHtml(table.corner.across)}</span><span class="down">${escapeHtml(table.corner.down)}</span></th>${table.columns
    .map((column) => `<th><strong>${escapeHtml(column.label)}</strong>${column.note ? `<small>${escapeHtml(column.note)}</small>` : ""}</th>`)
    .join("")}</tr>`;
  const rows = table.rows
    .map((row) => `<tr><th>${escapeHtml(row.label)}</th>${row.values.map((value) => `<td>${escapeHtml(value)}</td>`).join("")}</tr>`)
    .join("");
  return `<div class="reference${entry ? " with-entry" : ""}">${drawing}<table class="reference-table"><thead>${head}</thead><tbody>${rows}</tbody></table>${entry}</div>`;
}

function assertNever(value: never): never {
  throw new Error(`Unsupported sheet section: ${JSON.stringify(value)}`);
}

function renderBodySections(model: SheetDocumentModel): string {
  return model.definition.sections
    .map((section, sectionIndex) => {
      switch (section.type) {
        case "FIELDS":
          if (model.fieldsInHeader && section === model.headerSection) return "";
          return renderFields(
            section,
            model,
            sectionIndex === model.definition.sections.length - 1 &&
              model.definition.documentCodePosition === "BOTTOM_RIGHT"
              ? resolveDocumentIdentifier(model.definition)
              : null,
          );
        case "FIXED_ROWS":
          return renderFixedRows(section, model);
        case "MATRIX":
          return renderMatrix(section, model);
        case "NUMBERED_GRID":
          return renderNumberedGrid(section, model);
        case "NUMBERED_BLANKS":
          // The back of the sheet prints after the front's footer.
          return section.printedOnBack ? "" : renderNumberedBlanks(section, model);
        case "APPROVAL_STATUS":
          return "";
        case "DIAGRAMS":
          return renderDiagrams(section);
        case "REFERENCE_BAND":
          return renderReferenceBand(section, model);
        default:
          return assertNever(section);
      }
    })
    .join("");
}

/** What the paper prints on the back of the sheet, on a page of its own. */
function renderBackSections(model: SheetDocumentModel): string {
  return model.definition.sections
    .map((section) =>
      section.type === "NUMBERED_BLANKS" && section.printedOnBack
        ? renderNumberedBlanks(section, model)
        : "",
    )
    .join("");
}

function renderSignatures(model: SheetDocumentModel): string {
  if (!model.approvalSection) return "";
  return `<div class="signatures">${model.approvalSection.blocks
    .map((block) => {
      const signature = model.signatures[block.mappedTo];
      const value = signature
        ? `<strong>${escapeHtml(signature.displayName)}</strong>${signature.decidedAt ? `<small>${escapeHtml(signature.decidedAt)}</small>` : ""}`
        : "";
      return `<div class="signature-label">${escapeHtml(block.visibleLabel)}</div><div class="signature-value">${value}</div>`;
    })
    .join("")}</div>`;
}

export type RenderSheetHtmlInput = {
  definition: SheetTemplateDefinition;
  values: Record<string, unknown>;
  state: SheetState;
  signatures?: Partial<Record<SignatureRole, SheetSignature>>;
  title?: string;
};

export function renderSheetDocumentHtml(input: RenderSheetHtmlInput): string {
  const model = buildSheetDocumentModel(input.definition, input.values, input.signatures);
  const dateField = model.headerSection?.fields[0];
  const date = dateField ? model.values.get(dateField.key) ?? "" : "";
  const headerClass = model.headerLayout.toLowerCase().replaceAll("_", "-");
  const watermark = PDF_WATERMARK_LABEL[input.state];
  const page = model.printLayout;
  const letterhead = input.definition.letterhead;
  const stationery = letterhead
    ? `<div class="letterhead">${
        DIAGRAM_DATA_URIS[letterhead.asset]
          ? `<img src="${DIAGRAM_DATA_URIS[letterhead.asset]}" alt="${escapeHtml(letterhead.alt)}" />`
          : ""
      }</div>`
    : "";
  // A form with no header date may still print a mark in that slot: 士電
  // prints the customer the register belongs to. Never both — no paper does.
  // TITLE_FIELDS_RIGHT stacks every header field there instead, as
  // 個人生產日報表 prints 姓名 over 日期.
  const headerLead =
    model.headerLayout === "TITLE_FIELDS_RIGHT"
      ? (model.headerSection?.fields ?? [])
          .map(
            (field) =>
              `<div>${escapeHtml(field.label)}：${escapeHtml(model.values.get(field.key) ?? "")}</div>`,
          )
          .join("")
      : dateField
        ? `${escapeHtml(dateField.label)}：${escapeHtml(date)}`
        : escapeHtml(input.definition.headerNote ?? "");
  const header = `<header class="header ${headerClass}"><div class="date">${headerLead}</div><h1>${escapeHtml(input.definition.displayName)}</h1><div class="document-code">${model.documentAtTop ? escapeHtml(resolveDocumentIdentifier(input.definition) ?? "") : ""}</div></header>`;
  // Printed lines above or below the title: 巧力's 出廠檢驗單 addresses its
  // customer's 採購部 and names the company in place of a letterhead.
  const headerLines = (placement: "ABOVE" | "BELOW") =>
    (input.definition.headerLines ?? [])
      .filter((line) => line.placement === placement)
      .map((line) => `<div class="header-line ${line.align.toLowerCase()}">${escapeHtml(line.text)}</div>`)
      .join("");
  // Below the box: a mark at the left, such as 信太's VER 2.0, and the
  // identifier at the right.
  const footerNote = input.definition.footerNote;
  const note = footerNote
    ? `<span class="footer-note"${footerNote.color ? ` style="color:${escapeHtml(footerNote.color)}"` : ""}>${escapeHtml(footerNote.text)}</span>`
    : "";
  // Below the box, before the identifier: 首件/巡迴檢驗單's `單位：mm` at
  // the left and its ✓/✗ key at the right, on one line.
  const bottomLines = (input.definition.headerLines ?? []).filter(
    (line) => line.placement === "BOTTOM",
  );
  const bottom = bottomLines.length
    ? `<div class="bottom-lines">${bottomLines.map((line) => `<span class="${line.align.toLowerCase()}">${escapeHtml(line.text)}</span>`).join("")}</div>`
    : "";
  const below = model.documentBelowGrid || footerNote
    ? `<div class="below-document">${note}<span>${model.documentBelowGrid ? escapeHtml(resolveDocumentIdentifier(input.definition) ?? "") : ""}</span></div>`
    : "";
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>${escapeHtml(input.title ?? input.definition.displayName)}</title><style>
${documentStyles(page)}
</style></head><body><main class="document">${watermark ? `<div class="watermark" aria-label="${escapeHtml(watermark)}">${escapeHtml(watermark)}</div>` : ""}<div class="content">${stationery}${headerLines("ABOVE")}${header}${headerLines("BELOW")}${renderBodySections(model)}${bottom}${below}${renderSignatures(model)}${renderBackSections(model)}</div></main></body></html>`;
}
