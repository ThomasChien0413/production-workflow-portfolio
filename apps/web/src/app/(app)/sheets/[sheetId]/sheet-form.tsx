"use client";

import { Fragment } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, ScrollRegion } from "@workflow/ui";
import {
  describeRow,
  headingRows,
  isRowCornerCell,
  isPrintedMatrix,
  isRowGroupContinuation,
  printedCells,
  printedRowNumber,
  resolveComputedValue,
  isFieldEditableInState,
  resolveDocumentIdentifier,
  type SessionUser,
} from "@workflow/contracts";
import {
  buildSheetDocumentModel,
  flattenSheetValues,
} from "@workflow/sheet-document";
import { csrfHeaders } from "@/lib/csrf";
import { editorKinds } from "@/lib/sheet-permissions";
import { useSheetRealtime, type RealtimeStatus } from "@/lib/sheet-realtime";
import { useSheetRefresh } from "@/lib/sheet-refresh-provider";
import { useSheetVersion } from "@/lib/sheet-version";
import {
  anyFieldEditable,
  describeFieldKey,
  rowFieldKey,
  submitActionLabel,
  type SheetDetail,
  type TemplateDefinition,
  type TemplateSection,
} from "@/lib/sheet-model";
import {
  DiagramsBand,
  FieldsBand,
  FormCell,
  MatrixBand,
  NumberedBlanksBand,
  NumberedGridBand,
  PrintedMatrixBand,
  ReferenceBand,
  SignatureCells,
} from "./sheet-bands";
import { ProductionActions, SheetStatus } from "./production-actions";
import { SheetFit } from "./sheet-fit";
import { SubmitNotice, useSheetSubmit } from "./submit-sheet";
import { newMutationId } from "@/lib/mutation-id";

/**
 * Editing is explicit, not autosaved.
 *
 * DESIGN.md §9.1 originally specified a debounced autosave. The user asked for
 * the operator to decide when a sheet is written, so nothing leaves the browser
 * until 儲存 is pressed. Everything the autosave design existed to protect is
 * kept: patches still carry baseVersion and a clientMutationId, same-field
 * conflicts are still surfaced rather than overwritten, and unsaved work is now
 * guarded by an unload prompt because there is no longer a timer to catch it.
 */
type SaveState =
  | { kind: "idle" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "saved"; at: string }
  | { kind: "error"; message: string }
  | { kind: "conflict"; fields: string[] };

type PatchResponse = { result?: { version?: number } };
type ApiError = {
  message?: string;
  details?: { conflictingFields?: string[] };
  conflictingFields?: string[];
};

/** Display the accepted-save time in the business timezone. */
function timeLabel(): string {
  return new Intl.DateTimeFormat("zh-Hant-TW", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Taipei",
  }).format(new Date());
}

export function SheetForm({
  sheet,
  user,
  departmentHref,
}: {
  sheet: SheetDetail;
  user: SessionUser;
  /** Where to go once the sheet has been sent on and leaves this department. */
  departmentHref: string;
}) {
  const scheduleSheetRefresh = useSheetRefresh();
  const sheetVersion = useSheetVersion();
  const [values, setValues] = useState(() => flattenSheetValues(sheet.values));
  const [version, setVersion] = useState(sheet.version);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  // Fields edited since the last accepted write. Only these are sent, so a
  // save never rewrites values the operator did not touch.
  const [pending, setPending] = useState(new Map<string, string>());
  const pendingCount = pending.size;

  const submission = useSheetSubmit(sheet, user);

  // Rows 分條's 主管 has ticked off (the user, 2026-10-03). A tick shows at
  // once and is undone if the server refuses it.
  const [marked, setMarked] = useState(() => new Set(sheet.rowMarks?.marked ?? []));
  const [markError, setMarkError] = useState<string | null>(null);
  const serverMarks = sheet.rowMarks?.marked.join(",") ?? "";
  useEffect(() => {
    setMarked(new Set(serverMarks ? serverMarks.split(",").map(Number) : []));
  }, [serverMarks]);
  const toggleMark = async (rowIndex: number, next: boolean) => {
    if (!sheet.rowMarks) return;
    setMarkError(null);
    const apply = (on: boolean) =>
      setMarked((current) => {
        const updated = new Set(current);
        if (on) updated.add(rowIndex);
        else updated.delete(rowIndex);
        return updated;
      });
    apply(next);
    try {
      const response = await fetch(`/api/sheets/${sheet.id}/row-marks`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({
          clientMutationId: newMutationId(),
          sectionKey: sheet.rowMarks.sectionKey,
          rowIndex,
          marked: next,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ApiError | null;
        throw new Error(body?.message ?? "無法更新勾選");
      }
    } catch (error) {
      apply(!next);
      setMarkError(error instanceof Error ? error.message : "無法更新勾選");
    }
  };

  // The live connection. Kept in a ref for the merge below so the callback does
  // not need `pending` in its dependencies and re-subscribe on every keystroke.
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const [staleServerData, setStaleServerData] = useState(false);

  const realtime = useSheetRealtime(sheet.id, sheet.version, sheet.updatedAt, {
    /**
     * Someone else's accepted write. Fields this operator has not touched are
     * applied live; fields sitting in the unsaved buffer are left alone and
     * reported, because overwriting them would discard typing in front of them
     * (DESIGN.md §9.1) and a save would fail on those fields anyway (§9.2).
     */
    onRemoteValues: (incoming) => {
      const refused: string[] = [];
      const applied = new Map<string, string>();
      for (const [fieldKey, value] of incoming) {
        if (!pendingRef.current.has(fieldKey)) {
          applied.set(fieldKey, value);
          continue;
        }
        // The server already holds exactly what is in the buffer, so nothing
        // is at risk and there is nothing to report. Almost always this is
        // this client's own save coming back: the room broadcasts to everyone
        // including the author, and the buffer is not cleared until the write
        // is accepted. Without this, saving alone on a sheet raised
        // 「有人同時修改了你正在編輯的欄位」 against yourself — and a warning
        // that cries wolf is worse than no warning, because the one time it
        // matters it will be waved away too.
        if (pendingRef.current.get(fieldKey) === value) continue;
        refused.push(fieldKey);
      }
      if (applied.size > 0) {
        setValues((previous) => {
          const next = new Map(previous);
          for (const [fieldKey, value] of applied) next.set(fieldKey, value);
          return next;
        });
      }
      return refused;
    },
    onServerStateChanged: () => setStaleServerData(true),
  });

  // A structural change — state, assignment, approval, routing — means the
  // server-rendered half of this page is out of date. Refreshing while someone
  // is typing would be startling, so it waits until nothing is unsaved.
  useEffect(() => {
    if (!staleServerData || pendingCount > 0) return;
    setStaleServerData(false);
    scheduleSheetRefresh();
  }, [pendingCount, scheduleSheetRefresh, staleServerData]);

  const flush = useCallback(async () => {
    if (pending.size === 0) return;
    const changes = [...pending.entries()].map(([fieldKey, value]) => ({
      fieldKey,
      value,
    }));
    setSave({ kind: "saving" });

    try {
      const response = await fetch(`/api/sheets/${sheet.id}/values`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({
          baseVersion: version,
          clientMutationId: newMutationId(),
          changes,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ApiError | null;
        const conflicting =
          body?.details?.conflictingFields ?? body?.conflictingFields ?? [];
        if (conflicting.length > 0) {
          // Never silently overwrite — DESIGN.md §9.2.
          setSave({ kind: "conflict", fields: conflicting });
          // The live warning was the advance notice of exactly this; leaving
          // both on screen says the same thing twice.
          realtime.clearCollisions();
          return;
        }
        setSave({ kind: "error", message: body?.message ?? "儲存失敗，請重試。" });
        return;
      }

      const body = (await response.json()) as PatchResponse;
      if (typeof body.result?.version === "number") {
        setVersion(body.result.version);
        // The 交期, subpage and status controls write against this too.
        sheetVersion.report(body.result.version);
      }
      // Only clear the buffer once the server has accepted the write, so a
      // failure leaves the operator's edits intact and retryable.
      setPending(new Map());
      setSave({ kind: "saved", at: timeLabel() });
    } catch {
      setSave({ kind: "error", message: "無法連線到伺服器，變更仍保留在本機。" });
    }
  }, [pending, realtime, sheet.id, sheetVersion, version]);

  // Nothing saves on a timer any more, so leaving with unsaved work would lose
  // it silently. The browser prompt is the only guard the platform offers.
  useEffect(() => {
    if (pendingCount === 0) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pendingCount]);

  function edit(fieldKey: string, value: string) {
    setValues((previous) => new Map(previous).set(fieldKey, value));
    setPending((previous) => new Map(previous).set(fieldKey, value));
    setSave({ kind: "dirty" });
  }

  const definition = sheet.template.definition;
  const submitLabel = submitActionLabel(sheet.releaseDestination, sheet.review.outstanding);

  /**
   * Three conditions, all of which the API enforces again: who the user is to
   * this sheet (origin manager, or opted-in origin staff within the template's
   * `staffEditScope`), whether the field names that editor in `editableBy`,
   * and whether the field may be changed in the current state.
   */
  const editors = editorKinds(user, sheet);
  const editable = (field: { editableStates: string[]; editableBy: string[] }) =>
    editors.some((editor) => field.editableBy.includes(editor)) &&
    isFieldEditableInState(field.editableStates, sheet.state);
  // Owning the sheet is not the same as having something to change right now.
  const canEdit = anyFieldEditable(definition, sheet.state, editors);

  return (
    <div className="cc-stack">
      <div className="cc-row" style={{ justifyContent: "flex-end" }}>
        <PresenceChip participants={realtime.participants} selfId={user.id} />
        <ConnectionChip status={realtime.status} />
        <SaveChip state={save} />
      </div>

      {save.kind === "conflict" ? (
        <Alert tone="danger" title="內容衝突，需要處理" assertive>
          下列欄位在你編輯期間已被他人變更，因此這次的變更沒有寫入：
          {save.fields
            .map((fieldKey) => describeFieldKey(definition, fieldKey))
            .join("、")}
          。請重新整理以取得最新內容後再編輯。
        </Alert>
      ) : null}

      {/*
        Early warning, not an error. The remote value was not applied because
        this operator is holding an unsaved edit on the same field; saying so
        now is better than a conflict error after they press 儲存.
      */}
      {realtime.collisions.length > 0 ? (
        <Alert
          tone="warning"
          title="有人同時修改了你正在編輯的欄位"
          actions={
            <Button variant="secondary" size="sm" onClick={realtime.clearCollisions}>
              知道了
            </Button>
          }
        >
          {realtime.collisions
            .map((fieldKey) => describeFieldKey(definition, fieldKey))
            .join("、")}
          {" "}
          已被他人變更。你尚未儲存的內容仍保留在這裡；若直接儲存，這些欄位會被伺服器擋下。
          建議重新整理後再確認一次。
        </Alert>
      ) : null}

      {realtime.status === "revoked" ? (
        <Alert tone="warning" title="你已無法即時接收這張生產單的更新" assertive>
          你對這張生產單的存取權限已變更。畫面上的內容可能不是最新的，請重新整理。
        </Alert>
      ) : null}

      {realtime.status === "unauthenticated" ? (
        <Alert tone="danger" title="連線已中斷" assertive>
          你的登入階段已結束。請重新登入後再繼續。
        </Alert>
      ) : null}

      {markError ? (
        <Alert tone="danger" title="無法更新勾選" assertive>
          {markError}
        </Alert>
      ) : null}

      <SheetDocument
        definition={definition}
        values={values}
        editable={editable}
        onEdit={edit}
        signatures={sheet.signatures}
        {...(sheet.rowMarks
          ? {
              rowMarks: {
                sectionKey: sheet.rowMarks.sectionKey,
                marked,
                canMark: sheet.rowMarks.canMark,
                onToggle: toggleMark,
              },
            }
          : {})}
      />

      <SubmitNotice
        sheet={sheet}
        state={submission.state}
        unsavedCount={pendingCount}
        onCancel={submission.cancel}
        onSubmit={() => void submission.submit()}
        departmentHref={departmentHref}
      />

      {/*
        Explicit save, then explicit submit. Nothing is written until 儲存 is
        pressed, so the controls stay visible while scrolling a long form rather
        than sitting at the bottom of the page (DESIGN.md §3.3, sticky action
        region). Sending on — 送交燒頓 for a sheet its workflow sends
        elsewhere, the only submitting left since review was retired — is
        blocked while anything is unsaved: unsaved edits would not go with it.

        PDF download is a sheet-level read action, so the bar remains for
        reviewers and other read-only users even when save/submit are absent.
      */}
      {/* 生產狀態 sits right above 儲存 (the user, 2026-09-30). */}
      <SheetStatus sheet={sheet} user={user} version={version} onChanged={setVersion} />
      {/* 封存 and 恢復 right below it (the user, 2026-10-04). */}
      <ProductionActions sheet={sheet} user={user} />

      <div className="cc-action-bar">
        {canEdit || submission.submittable ? (
          <p className="cc-body-sm cc-action-bar__status">
            {pendingCount > 0 ? (
              <>
                尚有 <strong>{pendingCount}</strong> 個欄位未儲存
              </>
            ) : (
              <span className="cc-muted">所有變更皆已儲存</span>
            )}
          </p>
        ) : (
          <span className="cc-action-bar__status" />
        )}
        {/* Whichever action is actually available leads: 儲存 while there are
            unsaved edits, the submit action once there are none. */}
        {canEdit ? (
          <Button
            variant={pendingCount > 0 ? "primary" : "secondary"}
            size="lg"
            disabled={pendingCount === 0}
            loading={save.kind === "saving"}
            loadingLabel="儲存中…"
            onClick={() => void flush()}
          >
            儲存
          </Button>
        ) : null}
        {submission.submittable ? (
          <Button
            variant={pendingCount > 0 ? "secondary" : "primary"}
            size="lg"
            disabled={pendingCount > 0 || submission.state.kind === "sending"}
            onClick={submission.confirm}
            title={
              pendingCount > 0 ? `請先儲存未儲存的欄位，再${submitLabel}` : undefined
            }
          >
            {submitLabel}
          </Button>
        ) : null}
        <PdfDownloadButton sheetId={sheet.id} disabled={pendingCount > 0} />
      </div>

      {submission.submittable && pendingCount > 0 ? (
        <p className="cc-help">
          {`請先儲存，再${submitLabel}。未儲存的內容不會一併送出。`}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The printed form itself: title strip, grid, bands, signatures and the back
 * side, drawn from the pinned definition and the values given. It holds no
 * state of its own. The live sheet passes its buffer and editors; the create
 * page passes no values and nothing editable, to preview a blank form before
 * anything is created.
 */
export function SheetDocument({
  definition,
  values,
  editable,
  onEdit,
  signatures = {},
  rowMarks,
}: {
  definition: TemplateDefinition;
  values: Map<string, string>;
  editable: (field: { editableStates: string[]; editableBy: string[] }) => boolean;
  onEdit: (fieldKey: string, value: string) => void;
  /** Who signed each printed box; none on a preview or an unreviewed sheet. */
  signatures?: SheetDetail["signatures"];
  /** A tick in front of each row, where the receiving department ticks rows. */
  rowMarks?: {
    sectionKey: string;
    marked: ReadonlySet<number>;
    canMark: boolean;
    onToggle: (rowIndex: number, next: boolean) => void;
  };
}) {
  const edit = onEdit;
  /** No-op kept so cell components have a stable blur handler contract. */
  function flushNow() {}

  const documentModel = buildSheetDocumentModel(definition, values);
  const { headerSection, rowSection, approvalSection } = documentModel;

  const dateField = headerSection?.fields[0];
  /**
   * Printed layout facts come from the immutable definition. 分條製令單 keeps
   * its fields inside the grid; the two shorter forms put 日期 in the title
   * strip even though one prints its document number below the grid.
   */
  const { fieldsInHeader, documentAtTop, documentBelowGrid, headerLayout } =
    documentModel;
  const columns = rowSection?.columns ?? [];
  // Columns sharing one printed cell — `E: ＿K* ＿箱` — count once for
  // widths, spans and headings.
  const cells = rowSection ? printedCells(rowSection) : [];
  const groupedHeadings = rowSection?.headingGroups !== undefined;
  const rows = Array.from({ length: rowSection?.rowCount ?? 0 }, (_, i) => i);
  // EI客戶訂購表 starts with 訂日 rather than a serial number, so it prints no
  // number column. Inventing one for the screen would be a column the
  // operator cannot find on the paper in front of them.
  const numberedRows = rowSection?.rowNumbers ?? true;
  // Row groups: 生產日報表 gives each person a block of rows, their name in a
  // cell down its side and their number outside the box, in place of a
  // number per row.
  const groups = rowSection?.rowGroups;
  const groupNumbers = groups?.numbered ?? false;
  const leadColumn = numberedRows || groupNumbers;
  const leadUnits = numberedRows
    ? rowSection?.rowNumberWidthUnits
    : groups?.numberWidthUnits;
  const widthUnits = !rowSection?.columnWidthUnits
    ? null
    : leadColumn
      ? leadUnits !== undefined
        ? [leadUnits, ...rowSection.columnWidthUnits]
        : null
      : [...rowSection.columnWidthUnits];
  // Printed lines above or below the title: 巧力's 出廠檢驗單 addresses its
  // customer's 採購部 and names the company in place of a letterhead.
  const headerLines = (placement: "ABOVE" | "BELOW") =>
    (definition.headerLines ?? [])
      .filter((line) => line.placement === placement)
      .map((line) => (
        <p
          key={line.text}
          className={`cc-formsheet__headerline cc-formsheet__headerline--${line.align.toLowerCase()}`}
        >
          {line.text}
        </p>
      ));
  // Side-by-side blocks repeat the register across the width, with a gap
  // between: 巧力 prints 序 1–5 beside 6–10.
  const blockCount = rowSection?.blocks?.count ?? 1;
  const blockRows = (rowSection?.rowCount ?? 0) / blockCount;
  const blockGapUnits = rowSection?.blocks?.gapUnits;
  // A gap between blocks only where the paper leaves one: 巧力 does,
  // 退火明細表 sets its two blocks edge to edge.
  const blockGap = blockGapUnits !== undefined;
  const widthTotal =
    (widthUnits?.reduce((sum, width) => sum + width, 0) ?? 0) * blockCount +
    (blockCount - 1) * (blockGapUnits ?? 0);
  // Ticks in front of the rows (the user, 2026-10-03), on a plain register:
  // one column with no heading, and a ticked row painted green.
  const marking =
    rowMarks && rowSection && rowSection.key === rowMarks.sectionKey &&
    !groups && blockCount === 1 && !rowSection.standardRow && !groupedHeadings
      ? rowMarks
      : null;
  const gridSpan =
    (cells.length + (leadColumn ? 1 : 0)) * blockCount + (blockGap ? blockCount - 1 : 0) +
    (marking ? 1 : 0);
  // A standard row's corner runs down beside the headings and the standard:
  // 標準值 over 測試值 on 特性檢驗報告單, 位置 over 標準值 on 崧貿's copy.
  const standard = rowSection?.standardRow;
  const standardCorner = standard ? (
    <th scope="col" rowSpan={2} className="cc-formsheet__corner">
      <span className="cc-formsheet__corner-across">{standard.corner.across}</span>
      <span className="cc-formsheet__corner-down">{standard.corner.down}</span>
    </th>
  ) : null;
  const rowSectionIndex = rowSection
    ? definition.sections.indexOf(rowSection)
    : -1;

  /**
   * One printed band that is not the row grid, e.g. 分條製令單's matrices.
   * Bands render where the paper prints them: above the grid, or below it for
   * 生產日報表's 經理 / 組長. A FIELDS section already shown in the title strip
   * is not repeated.
   */
  const band = (section: TemplateSection, sectionIndex: number) => {
    if (
      section.type === "FIELDS" &&
      (!fieldsInHeader || section !== headerSection)
    ) {
      return (
        <FieldsBand
          key={section.key}
          section={section}
          values={values}
          editable={editable}
          onEdit={edit}
          onBlur={flushNow}
          // Only a form that prints its identifier in its last row, as the
          // PDF does: one that prints it below the box would show it twice.
          documentCode={
            sectionIndex === definition.sections.length - 1 &&
            definition.documentCodePosition === "BOTTOM_RIGHT"
              ? (resolveDocumentIdentifier(definition) ?? "")
              : null
          }
        />
      );
    }
    if (section.type === "MATRIX") {
      // 首件/巡迴檢驗單's layout; every older matrix keeps its own.
      if (isPrintedMatrix(section)) {
        return (
          <PrintedMatrixBand
            key={section.key}
            section={section}
            values={values}
            editable={editable}
            onEdit={edit}
            onBlur={flushNow}
          />
        );
      }
      return (
        <MatrixBand
          key={section.key}
          section={section}
          values={values}
          editable={editable}
          onEdit={edit}
          onBlur={flushNow}
        />
      );
    }
    if (section.type === "NUMBERED_GRID") {
      return (
        <NumberedGridBand
          key={section.key}
          section={section}
          values={values}
          editable={editable}
          onEdit={edit}
          onBlur={flushNow}
        />
      );
    }
    if (section.type === "REFERENCE_BAND") {
      return (
        <ReferenceBand
          key={section.key}
          section={section}
          values={values}
          editable={editable}
          onEdit={edit}
          onBlur={flushNow}
        />
      );
    }
    if (section.type === "NUMBERED_BLANKS") {
      // Printed on the back of the sheet: shown after the front, below.
      if (section.printedOnBack) return null;
      return (
        <NumberedBlanksBand
          key={section.key}
          section={section}
          values={values}
          editable={editable}
          onEdit={edit}
          onBlur={flushNow}
        />
      );
    }
    return null;
  };

  /**
   * One row's cells. In a row group the block's first row also carries its
   * number, outside the box, and the cell running down its side; the block's
   * other rows skip that column, which the spanning cell covers. A standard
   * row's lead cell is the corner above it, so it has none of its own.
   */
  const rowCells = (rowIndex: number) => {
    const section = rowSection!;
    const groupStart = groups !== undefined && rowIndex % groups.size === 0;
    // Where a cell is, in words a screen reader can say: 標準值, 尺寸,
    // 第 2 位 第 3 列 on a form of people, 第 3 列 on every other.
    const where = describeRow(section, rowIndex);
    const standardRow = section.standardRow !== undefined && rowIndex === 0;
    const lead =
      numberedRows && !standardRow ? (
        <th key="lead" scope="row" className="cc-formsheet__no">
          {printedRowNumber(section, rowIndex)}
        </th>
      ) : groups && groupNumbers && groupStart ? (
        <th
          key="lead"
          scope="rowgroup"
          rowSpan={groups.size}
          className="cc-formsheet__groupno"
        >
          {rowIndex / groups.size + 1}
        </th>
      ) : null;
    const rowCellsOut = cells.map(({ columns: parts, layout }) => {
      if (layout) {
        // One printed cell, several boxes: `E: ＿K* ＿箱` side by side, or
        // `E: ＿K` over `I: ＿K`. Each part is its own value.
        return (
          <td
            key={parts[0]!.key}
            className={`cc-formsheet__shared cc-formsheet__shared--${layout.toLowerCase()}`}
          >
            {parts.map((part) => {
              const key = rowFieldKey(section.key, rowIndex, part.key);
              return (
                <span className="cc-formsheet__withunit" key={part.key}>
                  {part.prefix ? (
                    <span className="cc-formsheet__unit" aria-hidden="true">
                      {part.prefix}
                    </span>
                  ) : null}
                  <input
                    className="cc-formsheet__cell"
                    aria-label={`${where} ${part.accessibleLabel ?? part.label}`}
                    value={values.get(key) ?? ""}
                    readOnly={!editable(part)}
                    onChange={(event) => edit(key, event.target.value)}
                    onBlur={flushNow}
                  />
                  {part.unit ? (
                    <span className="cc-formsheet__unit" aria-hidden="true">
                      {part.unit}
                    </span>
                  ) : null}
                </span>
              );
            })}
          </td>
        );
      }
      const column = parts[0]!;
      if (isRowGroupContinuation(section, rowIndex, column.key)) return null;
      if (section.cornerCell && isRowCornerCell(section, rowIndex, column.key)) {
        // Printed, ruled corner to corner: the row across holds 尺寸, the
        // column down 序號.
        return (
          <th key={column.key} scope="row" className="cc-formsheet__corner">
            <span className="cc-formsheet__corner-across">
              {section.cornerCell.across}
            </span>
            <span className="cc-formsheet__corner-down">
              {section.cornerCell.down}
            </span>
          </th>
        );
      }
      // Covered by the standard row's corner, which runs down from the heading.
      if (section.standardRow && isRowCornerCell(section, rowIndex, column.key)) {
        return null;
      }
      if (column.spacer) {
        return <td key={column.key} className="cc-formsheet__spacer" />;
      }
      const key = rowFieldKey(section.key, rowIndex, column.key);
      const spanning = groups !== undefined && column.key === groups.spanningColumnKey;
      const label = spanning
        ? `第 ${rowIndex / groups.size + 1} 位 ${column.label}`
        : `${where} ${column.accessibleLabel ?? column.label}`;
      const classes = [
        // The paper rules these cells corner to corner; the line is drawn
        // behind the box, which still takes one value as the printed
        // reproduction does.
        column.diagonalSplit ? "cc-formsheet__diagonal" : null,
        spanning ? "cc-formsheet__groupname" : null,
      ].filter(Boolean);
      const input = column.computed ? (
        // Worked out from the row, never stored: storing it would let it
        // drift from the cells it comes from.
        <output className="cc-formsheet__cell cc-formsheet__computed" aria-label={label}>
          {resolveComputedValue(column.computed, (factor) =>
            values.get(rowFieldKey(section.key, rowIndex, factor)),
          )}
        </output>
      ) : column.choices || column.multiline ? (
        // Boxes to tick on every row: 信太's 合格 / 不合格. Or a cell written
        // on several lines: 士電's 品名 takes two (2026-10-02).
        <FormCell
          field={column}
          fieldKey={key}
          label={label}
          value={values.get(key) ?? ""}
          editable={editable(column)}
          onEdit={edit}
          onBlur={flushNow}
        />
      ) : (
        <input
          className="cc-formsheet__cell"
          aria-label={label}
          value={values.get(key) ?? ""}
          readOnly={!editable(column)}
          onChange={(event) => edit(key, event.target.value)}
          onBlur={flushNow}
        />
      );
      return (
        <td
          key={column.key}
          rowSpan={spanning ? groups.size : undefined}
          className={classes.length > 0 ? classes.join(" ") : undefined}
          style={column.cellFill ? { backgroundColor: column.cellFill } : undefined}
        >
          {column.unit ? (
            // A unit printed in the cell after the value: mA, W.
            <span className="cc-formsheet__withunit">
              {input}
              <span className="cc-formsheet__unit" aria-hidden="true">
                {column.unit}
              </span>
            </span>
          ) : (
            input
          )}
        </td>
      );
    });
    return [lead, ...rowCellsOut];
  };
  const gridRow = (rowIndex: number) => {
    const ticked = marking?.marked.has(rowIndex) ?? false;
    return (
      <tr key={rowIndex} className={ticked ? "cc-formsheet__row--marked" : undefined}>
        {marking ? (
          <td className="cc-formsheet__mark">
            <label>
              <input
                type="checkbox"
                aria-label={`勾選${describeRow(rowSection!, rowIndex)}`}
                checked={ticked}
                disabled={!marking.canMark}
                onChange={(event) => marking.onToggle(rowIndex, event.target.checked)}
              />
            </label>
          </td>
        ) : null}
        {rowCells(rowIndex)}
      </tr>
    );
  };
  return (
    <>
        {/*
          Reproduces the printed form. The two transcribed forms differ in where
          the document number sits and how the header fields are laid out, and
          both are driven from the definition rather than from the template's
          name: 分條申請單 prints 日期 / title / 文件編號 as a strip above the
          grid, while 分條製令單 centres the title alone and prints its header
          fields as the first row of the table, with the document number in the
          last row beside 檢驗員.
        */}
        {/* On a phone, laid out at a desktop width and scaled to fit. */}
        <SheetFit>
          <div
            className={`cc-formsheet cc-formsheet--${headerLayout
              .toLowerCase()
              .replaceAll("_", "-")}${documentBelowGrid ? " cc-formsheet--document-below" : ""}`}
          >
            <ScrollRegion
              label={`${definition.displayName} 表格內容，可左右捲動`}
              variant="plain"
            >
              {definition.letterhead ? (
                /* Company stationery, printed above the form on 加工製令單. The
                   PDF inlines the same file, because it may not fetch anything. */
                <div className="cc-formsheet__letterhead">
                  {/* eslint-disable-next-line @next/next/no-img-element -- fixed
                      printed stationery, not user content. */}
                  <img
                    src={definition.letterhead.asset}
                    alt={definition.letterhead.alt}
                  />
                </div>
              ) : null}
              {headerLines("ABOVE")}
              <div className="cc-formsheet__head">
                <div className="cc-formsheet__date">
                  {headerLayout === "TITLE_FIELDS_RIGHT" && headerSection ? (
                    // 個人生產日報表 prints 姓名 over 日期 beside its title.
                    headerSection.fields.map((field) => (
                      <div className="cc-formsheet__headfield" key={field.key}>
                        <label htmlFor={field.key}>{field.label}:</label>
                        <input
                          id={field.key}
                          type={field.type === "DATE" ? "date" : "text"}
                          className="cc-formsheet__cell cc-tnum"
                          value={values.get(field.key) ?? ""}
                          readOnly={!editable(field)}
                          onChange={(event) => edit(field.key, event.target.value)}
                          onBlur={flushNow}
                        />
                      </div>
                    ))
                  ) : fieldsInHeader && dateField ? (
                    <>
                      <label htmlFor={dateField.key}>{dateField.label}:</label>
                      <input
                        id={dateField.key}
                        type={dateField.type === "DATE" ? "date" : "text"}
                        className="cc-formsheet__cell cc-tnum"
                        style={{ width: "auto", minHeight: "32px" }}
                        value={values.get(dateField.key) ?? ""}
                        readOnly={!editable(dateField)}
                        onChange={(event) => edit(dateField.key, event.target.value)}
                        onBlur={flushNow}
                      />
                    </>
                  ) : definition.headerNote ? (
                    // Printed text, never filled in: 士電 names the customer the
                    // register belongs to in the slot the date otherwise fills.
                    <span className="cc-formsheet__headernote">
                      {definition.headerNote}
                    </span>
                  ) : null}
                </div>
                <h2 className="cc-formsheet__title">{definition.displayName}</h2>
                <p className="cc-formsheet__doc">
                  {documentAtTop
                    ? (resolveDocumentIdentifier(definition) ?? "")
                    : ""}
                </p>
              </div>
              {headerLines("BELOW")}
              {/* Bands printed above the row grid, in printed order. */}
              {definition.sections.map((section, sectionIndex) =>
                rowSectionIndex === -1 || sectionIndex < rowSectionIndex
                  ? band(section, sectionIndex)
                  : null,
              )}

              {rowSection ? (
              <table
                className={`cc-formsheet__grid${groups ? " cc-formsheet__grid--grouped" : ""}${blockCount > 1 ? " cc-formsheet__grid--blocks" : ""}${groupedHeadings ? " cc-formsheet__grid--grouped-headings" : ""}`}
              >
                <caption className="cc-sr-only">
                  {definition.displayName}，共 {rows.length} 列，每列 {columns.length} 個欄位
                </caption>
                <colgroup>
                  {marking ? <col className="cc-formsheet__markcol" /> : null}
                  {Array.from({ length: blockCount }, (_, block) => (
                    <Fragment key={block}>
                      {block > 0 && blockGap ? (
                        // The gap between side-by-side blocks, as 巧力 prints it.
                        <col
                          style={{
                            width: widthUnits
                              ? `${(blockGapUnits! / widthTotal) * 100}%`
                              : "24px",
                          }}
                        />
                      ) : null}
                      {leadColumn ? (
                        <col
                          style={{
                            width: widthUnits
                              ? `${(widthUnits[0]! / widthTotal) * 100}%`
                              : "44px",
                          }}
                        />
                      ) : null}
                      {cells.map((cell, cellIndex) => (
                        <col
                          key={cell.columns[0]!.key}
                          style={
                            widthUnits
                              ? {
                                  width: `${(widthUnits[cellIndex + (leadColumn ? 1 : 0)]! / widthTotal) * 100}%`,
                                }
                              : undefined
                          }
                        />
                      ))}
                    </Fragment>
                  ))}
                </colgroup>
                <thead>
                  {rowSection.caption ? (
                    // 外觀尺寸, with 單位: mm to its right, ruled inside the box.
                    <tr>
                      <th
                        scope="colgroup"
                        className="cc-formsheet__captionrow"
                        colSpan={gridSpan}
                      >
                        <span>{rowSection.caption.text}</span>
                        {rowSection.caption.note ? (
                          <span className="cc-formsheet__captionnote">
                            {rowSection.caption.note}
                          </span>
                        ) : null}
                      </th>
                    </tr>
                  ) : null}
                  {groupedHeadings ? (
                    // 不良品 over C級 D級 報廢; 箱重/箱數 one tall heading over its
                    // E and I cells. Plain registers only: no blocks or corner.
                    headingRows(rowSection).map((headings, printedRow) => (
                      <tr key={printedRow}>
                        {printedRow === 0 && numberedRows ? (
                          <th scope="col" rowSpan={2} className="cc-formsheet__no">
                            {rowSection.rowNumberLabel || <span className="cc-sr-only">列號</span>}
                          </th>
                        ) : null}
                        {headings.map((heading) => (
                          <th
                            key={`${heading.label}-${heading.column?.key ?? "group"}`}
                            scope={heading.cells > 1 ? "colgroup" : "col"}
                            colSpan={heading.cells > 1 ? heading.cells : undefined}
                            rowSpan={heading.rows > 1 ? heading.rows : undefined}
                            className={
                              heading.column?.headingSmall ? "cc-formsheet__heading--small" : undefined
                            }
                            style={
                              heading.column?.headingFill
                                ? { backgroundColor: heading.column.headingFill }
                                : undefined
                            }
                          >
                            {heading.label}
                          </th>
                        ))}
                      </tr>
                    ))
                  ) : (
                  <tr
                    className={
                      standard && !standard.ruled ? "cc-formsheet__joined" : undefined
                    }
                  >
                    {marking ? (
                      <th scope="col" className="cc-formsheet__mark">
                        <span className="cc-sr-only">勾選</span>
                      </th>
                    ) : null}
                    {Array.from({ length: blockCount }, (_, block) => (
                      <Fragment key={block}>
                        {block > 0 && blockGap ? <td className="cc-formsheet__blockgap" /> : null}
                        {standard && numberedRows ? (
                          standardCorner
                        ) : numberedRows ? (
                          <th scope="col" className="cc-formsheet__no">
                            {rowSection.rowNumberLabel ? (
                              rowSection.rowNumberLabel
                            ) : (
                              <span className="cc-sr-only">列號</span>
                            )}
                          </th>
                        ) : groupNumbers ? (
                          // Above the numbers printed outside the box: nothing.
                          <th scope="col" className="cc-formsheet__groupno">
                            <span className="cc-sr-only">序</span>
                          </th>
                        ) : null}
                        {columns.map((column, columnIndex) =>
                          standard && !numberedRows && columnIndex === 0 ? (
                            <Fragment key={column.key}>{standardCorner}</Fragment>
                          ) : column.spacer ? (
                            // The gap the paper leaves between the form and the
                            // block printed beside it: a real column, ruled nowhere.
                            <td key={column.key} className="cc-formsheet__spacer" />
                          ) : (
                            <th
                              scope="col"
                              key={column.key}
                              className={
                                column.headingSmall ? "cc-formsheet__heading--small" : undefined
                              }
                              style={
                                column.headingFill
                                  ? { backgroundColor: column.headingFill }
                                  : undefined
                              }
                            >
                              {column.label}
                            </th>
                          ),
                        )}
                      </Fragment>
                    ))}
                  </tr>
                  )}
                  {standard ? (
                    // The standard, directly under the headings — under each
                    // letter in one tall cell where the paper draws no line.
                    <tr
                      className={`cc-formsheet__standard${standard.ruled ? "" : " cc-formsheet__joined"}`}
                    >
                      {rowCells(0)}
                    </tr>
                  ) : null}
                </thead>
                {groups ? (
                  // One body per block, so a heavier rule separates each person.
                  Array.from(
                    { length: rowSection.rowCount / groups.size },
                    (_, group) => (
                      <tbody key={group} className="cc-formsheet__group">
                        {Array.from({ length: groups.size }, (_, offset) =>
                          gridRow(group * groups.size + offset),
                        )}
                      </tbody>
                    ),
                  )
                ) : blockCount > 1 ? (
                  // Side by side: 巧力's 序 1–5 beside 6–10.
                  <tbody>
                    {Array.from({ length: blockRows }, (_, printed) => (
                      <tr key={printed}>
                        {Array.from({ length: blockCount }, (_, block) => (
                          <Fragment key={block}>
                            {block > 0 && blockGap ? <td className="cc-formsheet__blockgap" /> : null}
                            {rowCells(block * blockRows + printed)}
                          </Fragment>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                ) : (
                  <tbody>
                    {rows
                      .filter((rowIndex) => !standard || rowIndex > 0)
                      .map((rowIndex) => gridRow(rowIndex))}
                  </tbody>
                )}
                {rowSection.legend ? (
                  // Printed text closing the register inside its box, as the
                  // paper has it: 生產作業看板 explains its 工序 codes here, and
                  // 個人生產日報表 its 工作代號 codes, from the left on two lines.
                  <tfoot>
                    <tr>
                      <td
                        className={`cc-formsheet__legend${rowSection.legendAlign === "START" ? " cc-formsheet__legend--start" : ""}`}
                        colSpan={gridSpan}
                      >
                        {rowSection.legend}
                      </td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
              ) : null}

              {/* Bands printed below the row grid, e.g. 生產日報表's 經理 / 組長. */}
              {rowSectionIndex === -1
                ? null
                : definition.sections.map((section, sectionIndex) =>
                    sectionIndex > rowSectionIndex ? band(section, sectionIndex) : null,
                  )}

              {/* Illustrations print below the grid they describe. */}
              {definition.sections
                .filter(
                  (section): section is Extract<TemplateSection, { type: "DIAGRAMS" }> =>
                    section.type === "DIAGRAMS",
                )
                .map((section) => (
                  <DiagramsBand key={section.key} section={section} />
                ))}

              {/* Below the box, before the identifier: 首件/巡迴檢驗單's
                  單位：mm at the left and its ✓/✗ key at the right. */}
              {definition.headerLines?.some((line) => line.placement === "BOTTOM") ? (
                <div className="cc-formsheet__bottomlines">
                  {definition.headerLines
                    .filter((line) => line.placement === "BOTTOM")
                    .map((line) => (
                      <span
                        key={line.text}
                        className={`cc-formsheet__headerline--${line.align.toLowerCase()}`}
                      >
                        {line.text}
                      </span>
                    ))}
                </div>
              ) : null}

              {definition.footerNote ? (
                // A mark below the box at the left, such as 信太's VER 2.0,
                // opposite the identifier.
                <p className="cc-formsheet__footdoc cc-formsheet__footdoc--noted">
                  <span
                    style={
                      definition.footerNote.color
                        ? { color: definition.footerNote.color }
                        : undefined
                    }
                  >
                    {definition.footerNote.text}
                  </span>
                  <span>{documentBelowGrid ? resolveDocumentIdentifier(definition) : null}</span>
                </p>
              ) : documentBelowGrid ? (
                <p className="cc-formsheet__footdoc">
                  {resolveDocumentIdentifier(definition)}
                </p>
              ) : null}

              {approvalSection ? (
                <div className="cc-formsheet__signrow">
                  {approvalSection.blocks.map((block) => (
                    <SignatureCells
                      key={block.mappedTo}
                      label={block.visibleLabel}
                      signature={signatures[block.mappedTo as keyof SheetDetail["signatures"]]}
                    />
                  ))}
                </div>
              ) : null}
            </ScrollRegion>
          </div>
        </SheetFit>

        {/*
          What the paper prints on the back — 沖壓's 生產日報表 keeps its
          material labels there. The user asked for it below the front, so it
          is its own box under a 背面 heading rather than more of the front.
        */}
        {definition.sections.map((section) =>
          section.type === "NUMBERED_BLANKS" && section.printedOnBack ? (
            <section
              key={section.key}
              className="cc-formsheet cc-formsheet--back"
              aria-labelledby={`${section.key}-side`}
            >
              <h3 className="cc-formsheet__side" id={`${section.key}-side`}>
                背面
              </h3>
              <NumberedBlanksBand
                section={section}
                values={values}
                editable={editable}
                onEdit={edit}
                onBlur={flushNow}
              />
            </section>
          ) : null,
        )}

        {approvalSection ? (
          <p className="cc-caption cc-muted">
            {definition.workflow.requiresReview
              ? "送出審核後，申請單位欄填入申請部門；業務、協理、總經理核准後，各欄填入核准人姓名與時間。PDF 印出相同內容。"
              : "簽核欄位保留紙本版面，需要時請於列印後簽名。"}
          </p>
        ) : null}
    </>
  );
}

function PdfDownloadButton({
  sheetId,
  disabled,
}: {
  sheetId: string;
  disabled: boolean;
}) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "success" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function download(): Promise<void> {
    if (disabled || state.kind === "loading") return;
    setState({ kind: "loading" });
    try {
      const response = await fetch(`/api/sheets/${sheetId}/pdf`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { message?: string }
          | null;
        throw new Error(body?.message ?? "PDF 產生失敗，請稍後再試。");
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const encodedName = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
      const filename = encodedName ? decodeURIComponent(encodedName) : "sheet.pdf";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setState({ kind: "success" });
    } catch (error) {
      setState({
        kind: "error",
        message: error instanceof Error ? error.message : "PDF 產生失敗，請稍後再試。",
      });
    }
  }

  return (
    <>
      <Button
        variant="secondary"
        size="lg"
        disabled={disabled || state.kind === "loading"}
        loading={state.kind === "loading"}
        loadingLabel="正在產生 PDF…"
        title={disabled ? "請先儲存變更，再下載 PDF。" : undefined}
        onClick={() => void download()}
      >
        下載 PDF
      </Button>
      {disabled || state.kind === "error" ? (
        <span
          className={`cc-pdf-download-status${state.kind === "error" ? " cc-pdf-download-status--error" : ""}`}
          role={state.kind === "error" ? "alert" : "status"}
        >
          {state.kind === "error" ? state.message : "請先儲存變更，再下載 PDF。"}
        </span>
      ) : (
        <span className="cc-sr-only" role="status">
          {state.kind === "success" ? "PDF 已開始下載。" : ""}
        </span>
      )}
    </>
  );
}

/**
 * Who else is on this sheet right now. The list comes from the server's room
 * membership — a client cannot assert its own presence — and carries only id
 * and display name.
 */
function PresenceChip({
  participants,
  selfId,
}: {
  participants: { id: string; displayName: string }[];
  selfId: string;
}) {
  const others = participants.filter((participant) => participant.id !== selfId);
  if (others.length === 0) return null;
  return (
    <Badge tone="info">
      <span className="cc-sr-only">同時檢視中：</span>
      {others.map((participant) => participant.displayName).join("、")}
      {" 也在這張生產單上"}
    </Badge>
  );
}

/**
 * Connection state. Silent while everything works — a permanent "connected"
 * badge is noise; what matters is knowing when updates have stopped arriving.
 */
function ConnectionChip({ status }: { status: RealtimeStatus }) {
  if (status === "live") return null;
  const text = {
    connecting: "連線中…",
    offline: "已離線，正在重新連線",
    revoked: "已停止接收更新",
    unauthenticated: "連線已中斷",
  }[status];
  return (
    <span
      className={`cc-save ${status === "connecting" ? "cc-save--saving" : "cc-save--offline"}`}
      aria-live="polite"
    >
      {status === "connecting" ? <span className="cc-spinner" aria-hidden="true" /> : null}
      {text}
    </span>
  );
}

function SaveChip({ state }: { state: SaveState }) {
  const chip = {
    idle: { className: "", text: "尚未變更" },
    dirty: { className: "cc-save--dirty", text: "尚未儲存，請按儲存" },
    saving: { className: "cc-save--saving", text: "儲存中…" },
    saved: { className: "cc-save--saved", text: "" },
    error: { className: "cc-save--error", text: "" },
    conflict: { className: "cc-save--conflict", text: "內容衝突，需要處理" },
  }[state.kind];

  const text =
    state.kind === "saved"
      ? `已儲存 ${state.at}`
      : state.kind === "error"
        ? state.message
        : chip.text;

  return (
    <span className={`cc-save ${chip.className}`} aria-live="polite">
      {state.kind === "saving" ? <span className="cc-spinner" aria-hidden="true" /> : null}
      {text}
    </span>
  );
}
