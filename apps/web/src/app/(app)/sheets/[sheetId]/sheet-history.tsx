import type { SessionUser } from "@workflow/contracts";
import type { Department } from "@/lib/department-model";
import type {
  DepartmentStaffMember,
  SheetAssignment,
  SheetDetail,
  SheetHandoff,
} from "@/lib/sheet-model";

function taipei(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-Hant-TW", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Taipei",
  }).format(new Date(value));
}

type Event = {
  at: string;
  title: string;
  meta: string;
  note?: string | null;
  marker: "info" | "success" | "pending" | "danger" | "";
  glyph: string;
};

/**
 * Where the sheet has been and who has held it.
 *
 * Both records are immutable and both were already on the page — the detail
 * response has carried `handoffs` and `assignments` since the API was written,
 * and nothing rendered them, so a routed sheet gave no sign of where it had
 * come from. Handoffs and assignments interleave in time, so they are merged
 * into one chronological story rather than shown as two lists the reader has to
 * zip together mentally.
 */
export function SheetHistory({
  sheet,
  user,
  departments,
  staff,
}: {
  sheet: SheetDetail;
  user: SessionUser;
  /** Empty when the caller could not read the department list. */
  departments: Department[];
  /** Known only for the current department, and only to its manager. */
  staff: DepartmentStaffMember[];
}) {
  const departmentName = (id: string) =>
    departments.find((department) => department.id === id)?.displayName ?? "其他部門";

  /**
   * People are shown by name only when the name is already known: the signed-in
   * user, or a member of the department roster this manager may read. The API
   * returns ids and no names, and the screen does not invent one.
   */
  const personName = (id: string | null | undefined, fallback: string) => {
    if (!id) return fallback;
    if (id === user.id) return "你";
    return staff.find((member) => member.id === id)?.displayName ?? fallback;
  };

  const events: Event[] = [
    {
      at: sheet.createdAt,
      title: `${departmentName(sheet.originDepartmentId)} 建立生產單`,
      meta: taipei(sheet.createdAt),
      marker: "",
      glyph: "＋",
    },
    ...sheet.assignments.map((assignment) => assignmentEvent(assignment)),
    ...sheet.handoffs.map((handoff) => handoffEvent(handoff)),
  ];

  if (sheet.completedAt) {
    events.push({
      at: sheet.completedAt,
      title: "完成生產",
      meta: taipei(sheet.completedAt),
      marker: "success",
      glyph: "✓",
    });
  }
  if (sheet.archivedAt) {
    events.push({
      at: sheet.archivedAt,
      title: "封存",
      meta: `${taipei(sheet.archivedAt)}・此後不可再修改，部門主管可恢復`,
      marker: "",
      glyph: "▣",
    });
  }

  function assignmentEvent(assignment: SheetAssignment): Event {
    const who = personName(assignment.assignedUserId, "該部門員工");
    const by = personName(assignment.assignedByUserId, "該部門主管");
    const ended = assignment.endedAt
      ? `・已於 ${taipei(assignment.endedAt)} 結束`
      : "・進行中";
    return {
      at: assignment.createdAt,
      title: `${departmentName(assignment.departmentId)} 指派給 ${who}`,
      meta: `${taipei(assignment.createdAt)}・由 ${by} 指派・期限 ${taipei(assignment.dueAt)}${ended}`,
      marker: assignment.endedAt ? "info" : "pending",
      glyph: "→",
    };
  }

  function handoffEvent(handoff: SheetHandoff): Event {
    const prior = handoff.priorAssignment;
    const priorNote = prior?.assignedUserId
      ? `轉出前由 ${personName(prior.assignedUserId, "該部門員工")} 負責，期限 ${taipei(prior.dueAt)}`
      : null;
    return {
      at: handoff.createdAt,
      title: `${departmentName(handoff.sourceDepartmentId)} 轉送至 ${departmentName(
        handoff.destinationDepartmentId,
      )}`,
      meta: `${taipei(handoff.createdAt)}・第 ${handoff.sequence} 次轉送・由 ${personName(
        handoff.sentByUserId,
        "轉出部門主管",
      )} 送出`,
      note: [handoff.note, priorNote].filter(Boolean).join("\n") || null,
      marker: "info",
      glyph: "⇄",
    };
  }

  // Oldest first: this reads as a journey, unlike the approval history, where
  // the most recent decision is the one that matters.
  const ordered = [...events].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  );

  return (
    <ol className="cc-timeline">
      {ordered.map((event, index) => (
        <li className="cc-timeline__item" key={`${event.at}-${index}`}>
          <span
            className={`cc-timeline__marker${
              event.marker ? ` cc-timeline__marker--${event.marker}` : ""
            }`}
            aria-hidden="true"
          >
            {event.glyph}
          </span>
          <p className="cc-timeline__title">{event.title}</p>
          <p className="cc-timeline__meta">{event.meta}</p>
          {event.note ? (
            <p className="cc-timeline__note" style={{ whiteSpace: "pre-line" }}>
              {event.note}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
