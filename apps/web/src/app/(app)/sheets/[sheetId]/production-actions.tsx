"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Alert, Button, Field } from "@workflow/ui";
import type { SessionUser } from "@workflow/contracts";
import { csrfHeaders } from "@/lib/csrf";
import { SHEET_STATE_LABEL, type SheetDetail } from "@/lib/sheet-model";
import type { DepartmentSubpageView } from "@/lib/subpages";
import { useSheetRefresh } from "@/lib/sheet-refresh-provider";
import { useSheetVersion } from "@/lib/sheet-version";
import { useInteractive } from "@/lib/use-interactive";
import {
  canArchive,
  canChangeStatus,
  canRestore,
  canSetDueDate,
  managesCurrentDepartment,
} from "@/lib/sheet-permissions";
import { newMutationId } from "@/lib/mutation-id";

type ApiError = { message?: string; requestId?: string | undefined };

/**
 * One sheet action at a time: POST it, show why it failed, and refresh the
 * page once it succeeds. The mutation and the real-time room both announce
 * the same structural change; one shared scheduler coalesces them, otherwise
 * simultaneous RSC refreshes can race and React may discard the fresh tree.
 */
function useSheetMutation(sheetId: string) {
  const scheduleSheetRefresh = useSheetRefresh();
  const sheetVersion = useSheetVersion();
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function post(
    path: string,
    body: Record<string, unknown>,
    label: string,
  ): Promise<Record<string, unknown> | null> {
    setBusy(label);
    setError(null);
    try {
      const response = await fetch(`/api/sheets/${sheetId}/${path}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ clientMutationId: newMutationId(), ...body }),
      });
      const payload = (await response.json().catch(() => null)) as
        | (ApiError & { result?: Record<string, unknown> })
        | null;
      if (!response.ok) {
        setError({
          message: payload?.message ?? "操作失敗，請稍後再試。",
          requestId: payload?.requestId,
        });
        return null;
      }
      const result = payload?.result ?? {};
      if (typeof result.version === "number") sheetVersion.report(result.version);
      scheduleSheetRefresh();
      return result;
    } catch {
      setError({ message: "無法連線到伺服器，請檢查網路後再試一次。" });
      return null;
    } finally {
      setBusy(null);
    }
  }

  return { post, busy, error, latestVersion: sheetVersion.latest };
}

function MutationError({ error }: { error: ApiError | null }) {
  if (!error) return null;
  return (
    <Alert tone="danger" title="無法完成操作" assertive>
      <p>{error.message}</p>
      {error.requestId ? (
        <p className="cc-caption" style={{ marginTop: "var(--cc-space-1)" }}>
          錯誤代碼 {error.requestId}
        </p>
      ) : null}
    </Alert>
  );
}

/**
 * What the department 主管 does with a finished sheet: archive it once it is
 * 已完成, and bring an archived one back. A finished sheet is not handed on to
 * another department (the user, 2026-10-04). The 交期 and the subpage are set
 * in the details box, and the status above 儲存 (the user, 2026-09-30); the
 * page renders this card only when there is something here.
 */
export function ProductionActions({
  sheet,
  user,
}: {
  sheet: SheetDetail;
  user: SessionUser;
}) {
  const [hydrated, setHydrated] = useState(false);
  const { post, busy, error } = useSheetMutation(sheet.id);

  useEffect(() => {
    setHydrated(true);
  }, []);

  const archivable = canArchive(user, sheet);
  const restorable = canRestore(user, sheet);
  // Most readers have neither; they see nothing here, not even while loading.
  if (!archivable && !restorable) return null;

  // These controls submit client-side mutations. If enabled buttons appear in
  // the server HTML before React attaches their handlers, a fast tap is
  // silently discarded. Render an announced loading state until this action
  // boundary itself is ready to receive input.
  if (!hydrated) {
    return (
      <p className="cc-body-sm cc-muted" role="status">
        封存操作載入中…
      </p>
    );
  }
  return (
    <div className="cc-stack">
      <MutationError error={error} />
      {restorable ? (
        <RestoreAction
          busy={busy === "restore"}
          onConfirm={async () => (await post("restore", {}, "restore")) !== null}
        />
      ) : null}
      {archivable ? (
        <ArchiveAction
          busy={busy === "archive"}
          onConfirm={async () => (await post("archive", {}, "archive")) !== null}
        />
      ) : null}
    </div>
  );
}

/**
 * The details box — 建立時間, 最後更新, 交期, 工作子分頁 — with the 主管's two
 * settings folded into it (the user, 2026-09-30): 修改 opens the 交期 editor
 * under its row, 移動 the subpage choice under its row. A sheet waiting in
 * 待分派 opens the choice at once, because it needs a subpage before anyone
 * can work on it.
 */
export function SheetDetails({
  sheet,
  user,
  subpages,
  formGovernedByTicks,
  labels,
}: {
  sheet: SheetDetail;
  user: SessionUser;
  subpages: DepartmentSubpageView[];
  /**
   * Whether this form is in the department's 可使用的表單 checklist. A form
   * handed in from another department is not, and may go to any subpage.
   */
  formGovernedByTicks: boolean;
  /** Taipei times, formatted on the server so both renders agree. */
  labels: { created: string; updated: string; due: string };
}) {
  const interactive = useInteractive();
  const { post, busy, error, latestVersion } = useSheetMutation(sheet.id);
  const dueDateSettable = canSetDueDate(user, sheet);
  const manages = managesCurrentDepartment(user, sheet);
  // Only subpages whose 設定 ticks this form may receive it (DESIGN.md §3.2.24).
  const formSubpages = formGovernedByTicks
    ? subpages.filter((subpage) => subpage.enabledTemplateIds.includes(sheet.template.id))
    : subpages;
  const movable = manages && formSubpages.some((subpage) => subpage.id !== sheet.subpageId);
  const placing = sheet.subpageId === null;
  const [editingDue, setEditingDue] = useState(false);
  const [moving, setMoving] = useState(placing && movable);
  // Placing and then setting the 交期 straight after, or saving the form
  // first, moves the version before the page's copy catches up; write against
  // the newest one the page has heard of.
  const baseVersion = () => latestVersion(sheet.version);
  const subpageName =
    subpages.find((subpage) => subpage.id === sheet.subpageId)?.name ??
    (sheet.subpageId ? "其他子分頁" : "待分派");

  return (
    <div className="cc-stack">
      <MutationError error={error} />
      <dl className="cc-sheet-card__meta cc-sheet-details">
        <dt>建立時間</dt>
        <dd className="cc-tnum">{labels.created}</dd>
        <dt>最後更新</dt>
        <dd className="cc-tnum">{labels.updated}</dd>
        <dt>交期</dt>
        <dd className="cc-sheet-details__value">
          <span className="cc-tnum">{labels.due}</span>
          {dueDateSettable ? (
            <Button
              variant="tertiary"
              disabled={!interactive}
              aria-expanded={editingDue}
              aria-controls="sheet-due-editor"
              onClick={() => setEditingDue((open) => !open)}
            >
              {editingDue ? "收合" : "修改"}
              <span className="cc-sr-only">交期</span>
            </Button>
          ) : null}
        </dd>
        {dueDateSettable && editingDue ? (
          <dd className="cc-sheet-details__editor" id="sheet-due-editor">
            <DueDateForm
              // Keyed on the saved 交期 so a finished save re-seeds the field.
              key={sheet.dueAt ?? "none"}
              sheet={sheet}
              busy={busy === "due-date"}
              onSubmit={async (dueAt) => {
                const done = await post("due-date", { baseVersion: baseVersion(), dueAt }, "due-date");
                if (done) setEditingDue(false);
                return done !== null;
              }}
            />
          </dd>
        ) : null}
        <dt>工作子分頁</dt>
        <dd className="cc-sheet-details__value">
          <span>{subpageName}</span>
          {movable ? (
            <Button
              variant="tertiary"
              disabled={!interactive}
              aria-expanded={moving}
              aria-controls="sheet-subpage-editor"
              onClick={() => setMoving((open) => !open)}
            >
              {moving ? "收合" : placing ? "放入" : "移動"}
              <span className="cc-sr-only">工作子分頁</span>
            </Button>
          ) : null}
        </dd>
        {movable && moving ? (
          <dd className="cc-sheet-details__editor" id="sheet-subpage-editor">
            {placing ? (
              <p className="cc-body-sm cc-secondary">
                這張生產單從其他部門轉入，尚未放入子分頁。放入後，該子分頁有修改權限的人員即可更新生產狀態。
              </p>
            ) : null}
            <SheetSubpageMove
              // Keyed on the subpage so a finished move clears the choice.
              key={sheet.subpageId ?? "none"}
              sheet={sheet}
              subpages={formSubpages}
              formGovernedByTicks={formGovernedByTicks}
              busy={busy === "subpage"}
              onSubmit={async (subpageId) => {
                const done = await post("subpage", { baseVersion: baseVersion(), subpageId }, "subpage");
                if (done) setMoving(false);
                return done !== null;
              }}
            />
          </dd>
        ) : null}
      </dl>
    </div>
  );
}

/**
 * 生產狀態 above 儲存 (the user, 2026-09-30), inside the form's own stack so
 * it writes against the form's current version: a save moments earlier has
 * already moved it past the page's. A sheet still to be sent on shows why its
 * status is not set here.
 */
export function SheetStatus({
  sheet,
  user,
  version,
  onChanged,
}: {
  sheet: SheetDetail;
  user: SessionUser;
  version: number;
  onChanged: (version: number) => void;
}) {
  const { post, busy, error, latestVersion } = useSheetMutation(sheet.id);
  // 分條申請單 is reviewed first (the user, 2026-10-01); its status opens
  // once 總經理 has approved it.
  if (sheet.review.outstanding) {
    const goesTo = sheet.releaseDestination?.displayName;
    return (
      <p className="cc-body-sm cc-secondary">
        {sheet.review.stageRole
          ? `審核中：${SHEET_STATE_LABEL[sheet.state]}。`
          : "請先送出審核。"}
        業務、協理、總經理依序核准後，
        {goesTo ? `送至${goesTo}，由${goesTo}更新生產狀態。` : "即可更新生產狀態。"}
      </p>
    );
  }
  if (sheet.releaseDestination) {
    return (
      <p className="cc-body-sm cc-secondary">
        送交{sheet.releaseDestination.displayName}後，由{sheet.releaseDestination.displayName}更新生產狀態。
      </p>
    );
  }
  if (!canChangeStatus(user, sheet)) return null;
  return (
    <div className="cc-stack">
      <MutationError error={error} />
      <StatusControl
        // Keyed on the saved status so a finished change re-seeds the choice.
        key={sheet.state}
        sheet={sheet}
        busy={busy === "status"}
        onSubmit={async (state) => {
          const result = await post("status", { baseVersion: latestVersion(version), state }, "status");
          if (result && typeof result.version === "number") onChanged(result.version);
          return result !== null;
        }}
      />
    </div>
  );
}

const PRODUCTION_STATUSES = ["READY", "IN_PROGRESS", "COMPLETED"] as const;

/**
 * 待生產, 生產中, 已完成 as one group of choices, set by hand in any order (the
 * user, 2026-09-30). Radio buttons rather than a select, so the three are seen
 * at once; the change is written only when 更新狀態 is pressed.
 */
function StatusControl({
  sheet,
  busy,
  onSubmit,
}: {
  sheet: SheetDetail;
  busy: boolean;
  onSubmit: (state: (typeof PRODUCTION_STATUSES)[number]) => Promise<boolean>;
}) {
  const interactive = useInteractive();
  const [state, setState] = useState(sheet.state);
  return (
    <fieldset className="cc-stack cc-status-choice">
      <legend className="cc-label">生產狀態</legend>
      <div className="cc-row">
        {PRODUCTION_STATUSES.map((option) => (
          <label className="cc-choice" key={option}>
            <input
              type="radio"
              name="sheet-status"
              value={option}
              checked={state === option}
              disabled={!interactive || busy}
              onChange={() => setState(option)}
            />
            <span>{SHEET_STATE_LABEL[option]}</span>
          </label>
        ))}
        <Button
          variant="primary"
          disabled={!interactive || state === sheet.state}
          loading={busy}
          loadingLabel="更新中…"
          onClick={() => void onSubmit(state as (typeof PRODUCTION_STATUSES)[number])}
        >
          更新狀態
        </Button>
      </div>
      <p className="cc-help">此子分頁有修改權限的人員都可以更新。完成後，部門主管可以封存。</p>
    </fieldset>
  );
}

function SheetSubpageMove({
  sheet,
  subpages,
  formGovernedByTicks,
  busy,
  onSubmit,
}: {
  sheet: SheetDetail;
  subpages: DepartmentSubpageView[];
  formGovernedByTicks: boolean;
  busy: boolean;
  onSubmit: (subpageId: string) => Promise<boolean>;
}) {
  const interactive = useInteractive();
  const [subpageId, setSubpageId] = useState("");
  const options = subpages.filter((subpage) => subpage.id !== sheet.subpageId);
  // Placing a sheet that waits in 待分派 is the same action as moving one.
  const placing = sheet.subpageId === null;

  return (
    <div className="cc-stack">
      <div className="cc-field">
        <label className="cc-label" htmlFor="move-sheet-subpage">
          {placing ? "放入子分頁" : "移動到其他子分頁"}
        </label>
        <select
          id="move-sheet-subpage"
          className="cc-select"
          value={subpageId}
          disabled={!interactive || busy}
          onChange={(event) => setSubpageId(event.target.value)}
        >
          <option value="">請選擇</option>
          {options.map((subpage) => (
            <option key={subpage.id} value={subpage.id}>
              {subpage.name}
            </option>
          ))}
        </select>
        <p className="cc-help">
          {formGovernedByTicks ? "只列出已勾選此表單的子分頁。" : null}
          查看與修改權限會立即依目的子分頁更新。
        </p>
      </div>
      <div className="cc-row">
        <Button
          variant={placing ? "primary" : "secondary"}
          disabled={!interactive || !subpageId}
          loading={busy}
          loadingLabel={placing ? "放入中…" : "移動中…"}
          onClick={() => void onSubmit(subpageId)}
        >
          {placing ? "放入子分頁" : "移動子分頁"}
        </Button>
      </div>
    </div>
  );
}

/**
 * The 交期, set on its own now that nothing is assigned (the user,
 * 2026-09-30). Overdue reminders go to the department's 主管 once a day.
 */
function DueDateForm({
  sheet,
  busy,
  onSubmit,
}: {
  sheet: SheetDetail;
  busy: boolean;
  onSubmit: (dueAt: string | null) => Promise<boolean>;
}) {
  const interactive = useInteractive();
  const [dueLocal, setDueLocal] = useState(defaultDue(sheet.dueAt));
  const [issue, setIssue] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dueLocal) {
      setIssue("請設定交期。");
      return;
    }
    const dueAt = new Date(dueLocal);
    if (Number.isNaN(dueAt.getTime())) {
      setIssue("交期格式不正確。");
      return;
    }
    // The API rejects a 交期 at or before now; say so here rather than
    // spending a round trip to be told.
    if (dueAt.getTime() <= Date.now()) {
      setIssue("交期必須晚於現在。");
      return;
    }
    setIssue(null);
    await onSubmit(dueAt.toISOString());
  }

  return (
    <form className="cc-stack" onSubmit={handleSubmit} noValidate>
      {issue ? (
        <Alert tone="warning" title="請先修正">
          {issue}
        </Alert>
      ) : null}
      <Field
        label="交期"
        name="dueAt"
        type="datetime-local"
        value={dueLocal}
        disabled={!interactive || busy}
        onChange={(event) => setDueLocal(event.target.value)}
        help="以你裝置的時間輸入，系統會以台北時間顯示給所有人。逾期後每天提醒部門主管一次。"
      />
      <div className="cc-row">
        <Button type="submit" variant="secondary" disabled={!interactive} loading={busy} loadingLabel="儲存中…">
          {sheet.dueAt ? "更新交期" : "設定交期"}
        </Button>
        {sheet.dueAt ? (
          <Button variant="tertiary" disabled={!interactive || busy} onClick={() => void onSubmit(null)}>
            清除交期
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function ArchiveAction({
  busy,
  onConfirm,
}: {
  busy: boolean;
  onConfirm: () => Promise<boolean>;
}) {
  const interactive = useInteractive();
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="cc-stack">
      <p className="cc-body-sm cc-secondary">
        封存代表這張生產單已經結案。封存後不能再修改，紀錄保留一年，之後連同附件永久刪除。部門主管可在完工紀錄中將它恢復到原本的子分頁。
      </p>
      {confirming ? (
        <Alert tone="warning" title="確認封存？">
          <p className="cc-body-sm">
            封存後這張生產單會離開子分頁，只在完工紀錄中顯示。若一年內沒有恢復，它與附件會永久刪除。
          </p>
          <div className="cc-row" style={{ marginTop: "var(--cc-space-3)" }}>
            <Button
              variant="danger"
              disabled={!interactive}
              loading={busy}
              loadingLabel="封存中…"
              onClick={() => void onConfirm()}
            >
              確認封存
            </Button>
            <Button variant="secondary" disabled={busy || !interactive} onClick={() => setConfirming(false)}>
              取消
            </Button>
          </div>
        </Alert>
      ) : (
        <div className="cc-row">
          <Button variant="danger-quiet" disabled={!interactive} onClick={() => setConfirming(true)}>
            封存生產單
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Bringing an archived sheet back (the user, 2026-10-04): it returns to its
 * subpage as 已完成 and its deletion is cancelled. Archiving it again is how
 * it is undone, so one press does it.
 */
function RestoreAction({
  busy,
  onConfirm,
}: {
  busy: boolean;
  onConfirm: () => Promise<boolean>;
}) {
  const interactive = useInteractive();
  return (
    <div className="cc-stack">
      <p className="cc-body-sm cc-secondary">
        恢復後這張生產單會回到原本的子分頁，狀態為已完成，並取消預定的刪除。
      </p>
      <div className="cc-row">
        <Button
          variant="primary"
          disabled={!interactive}
          loading={busy}
          loadingLabel="恢復中…"
          onClick={() => void onConfirm()}
        >
          恢復到子分頁
        </Button>
      </div>
    </div>
  );
}

/** Current 交期 as a `datetime-local` value, or blank. */
function defaultDue(dueAt: string | null): string {
  if (!dueAt) return "";
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}T${pad(due.getHours())}:${pad(due.getMinutes())}`;
}
