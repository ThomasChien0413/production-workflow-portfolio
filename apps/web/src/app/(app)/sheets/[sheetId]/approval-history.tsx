import { roleLabels, type RoleCode } from "@workflow/contracts";
import type { SheetApprovalStep } from "@/lib/sheet-model";

function taipei(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-Hant-TW", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Taipei",
  }).format(new Date(value));
}

function roleName(role: string): string {
  return roleLabels[role as RoleCode] ?? role;
}

/**
 * The API returns a flat join — one row per reviewer, ordered by run then
 * sequence. Group it here rather than asking the API to nest it: the shape it
 * returns is the one its own tests pin.
 */
function groupRuns(approvals: SheetApprovalStep[]) {
  const runs = new Map<number, SheetApprovalStep[]>();
  for (const step of approvals) {
    const existing = runs.get(step.runNumber);
    if (existing) existing.push(step);
    else runs.set(step.runNumber, [step]);
  }
  return [...runs.entries()]
    .map(([runNumber, steps]) => ({
      runNumber,
      status: steps[0]?.runStatus ?? "PENDING",
      submittedAt: steps[0]?.submittedAt ?? null,
      steps: [...steps].sort((a, b) => a.sequence - b.sequence),
    }))
    // Newest first: what happened last is what a reviewer needs first.
    .sort((a, b) => b.runNumber - a.runNumber);
}

/**
 * Every approval run, newest first.
 *
 * A rejection does not erase what came before it: resubmission opens a new run
 * and the earlier one stays visible with its decisions intact (DESIGN.md §7.2).
 * Showing only the current run would hide that a sheet has been round the loop
 * before, which is exactly what a reviewer needs to know.
 */
export function ApprovalHistory({
  approvals,
  requiresReview,
}: {
  approvals: SheetApprovalStep[];
  requiresReview: boolean;
}) {
  if (approvals.length === 0) {
    // "Not submitted yet" would promise a review a review-free form never gets.
    return (
      <p className="cc-body-sm cc-muted">
        {requiresReview
          ? "尚未送出審核，因此還沒有審核紀錄。"
          : "此範本不需審核，因此不會有審核紀錄。"}
      </p>
    );
  }

  return (
    <div className="cc-stack">
      {groupRuns(approvals).map((run) => (
        <section
          key={run.runNumber}
          className="cc-stack"
          style={{ gap: "var(--cc-space-3)" }}
        >
          <h3 className="cc-overline">
            第 {run.runNumber} 次審核・{runStatusLabel(run.status)}・送出於{" "}
            {taipei(run.submittedAt)}
          </h3>
          <ol className="cc-timeline">
            {run.steps.map((step) => (
              <li className="cc-timeline__item" key={`${run.runNumber}-${step.sequence}`}>
                <span
                  className={`cc-timeline__marker ${markerClass(step.decision)}`}
                  aria-hidden="true"
                >
                  {markerGlyph(step.decision)}
                </span>
                <p className="cc-timeline__title">{roleName(step.requiredRole)}</p>
                <p className="cc-timeline__meta">
                  {decisionLabel(step.decision)}
                  {step.decidedAt ? `・${taipei(step.decidedAt)}` : ""}
                </p>
                {step.comment ? <p className="cc-timeline__note">{step.comment}</p> : null}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function runStatusLabel(status: SheetApprovalStep["runStatus"]): string {
  const labels = {
    PENDING: "進行中",
    APPROVED: "已通過",
    RETURNED: "已退回",
    INVALIDATED: "已失效",
  } as const;
  return labels[status] ?? status;
}

function decisionLabel(decision: SheetApprovalStep["decision"]): string {
  const labels = {
    PENDING: "等待審核",
    APPROVED: "已核准",
    REJECTED: "已退回",
  } as const;
  return labels[decision] ?? decision;
}

function markerClass(decision: SheetApprovalStep["decision"]): string {
  if (decision === "APPROVED") return "cc-timeline__marker--success";
  if (decision === "REJECTED") return "cc-timeline__marker--danger";
  return "cc-timeline__marker--pending";
}

function markerGlyph(decision: SheetApprovalStep["decision"]): string {
  if (decision === "APPROVED") return "✓";
  if (decision === "REJECTED") return "✕";
  return "…";
}

/**
 * The reason given by the most recent 退回. This is the one piece of the
 * history the department fixing a returned sheet must not have to go looking
 * for.
 */
export function latestRejection(
  approvals: SheetApprovalStep[],
): { role: string; comment: string; decidedAt: string | null } | null {
  const rejection = [...approvals]
    .filter((step) => step.decision === "REJECTED")
    .sort((a, b) => b.runNumber - a.runNumber)[0];
  if (!rejection?.comment) return null;
  return {
    role: roleName(rejection.requiredRole),
    comment: rejection.comment,
    decidedAt: rejection.decidedAt,
  };
}
