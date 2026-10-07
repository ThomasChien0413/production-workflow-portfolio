import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Alert, Badge } from "@workflow/ui";
import { listDepartments } from "@/lib/departments";
import { getSessionUser } from "@/lib/session";
import { isCompanyReader, managesDepartment } from "@workflow/domain";
import { resolveDocumentIdentifier } from "@workflow/contracts";
import {
  actorOf,
  managesCurrentDepartment,
  reviewerRole,
} from "@/lib/sheet-permissions";
import {
  SHEET_STATE_LABEL,
  SHEET_STATE_TONE,
  getSheet,
  listDepartmentStaff,
  listSheetAttachments,
} from "@/lib/sheets";
import { listFieldHistory } from "@/lib/audit";
import { sheetDeletionAt } from "@/lib/retention";
import { SheetRefreshProvider } from "@/lib/sheet-refresh-provider";
import { SheetVersionProvider } from "@/lib/sheet-version";
import { ApprovalHistory, latestRejection } from "./approval-history";
import { ReviewSheet } from "./review-sheet";
import { FieldHistory } from "./field-history";
import { SheetDetails } from "./production-actions";
import { SheetHistory } from "./sheet-history";
import { SheetForm } from "./sheet-form";
import { SheetAttachments } from "./sheet-attachments";
import { getOptionalDepartmentSubpages } from "@/lib/subpages";
import { MarkNotificationsRead } from "./mark-notifications-read";

export const metadata: Metadata = { title: "生產單 · Workflow Portfolio" };

function taipei(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-Hant-TW", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Taipei",
  }).format(new Date(value));
}

export default async function SheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ sheetId: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const { sheetId } = await params;
  const { from } = await searchParams;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const sheet = await getSheet(sheetId);
  if (!sheet) notFound();

  const definition = sheet.template.definition;
  const documentIdentifier = resolveDocumentIdentifier(definition);

  // Nobody is assigned (the user, 2026-09-30): whoever may modify the sheet
  // in its subpage starts and completes it, and the current department's 主管
  // set its 交期, place it, and archive or restore it. Department names are
  // company-wide navigation, so the history below can name them for any reader.
  const runsProduction = managesCurrentDepartment(user, sheet);
  /**
   * Rosters for every department in this sheet's history that the reader
   * actually manages — usually one, often the same as the current department.
   * Without this a manager loses their own employees' names the moment the
   * sheet moves on, because the roster fetched would be the destination's.
   * Departments they do not manage stay anonymous; there is no API that would
   * tell them those names, and the screen does not invent one.
   */
  const historyDepartmentIds = [
    ...new Set([
      sheet.currentDepartmentId,
      sheet.originDepartmentId,
      ...sheet.assignments.map((assignment) => assignment.departmentId),
    ]),
  ].filter((departmentId) =>
    managesDepartment(actorOf(user), departmentId),
  );

  const [rosters, departments, fieldHistory, attachments, subpageData] = await Promise.all([
    Promise.all(historyDepartmentIds.map(listDepartmentStaff)),
    listDepartments(),
    listFieldHistory(sheet.id),
    listSheetAttachments(sheet.id),
    getOptionalDepartmentSubpages(sheet.currentDepartmentId),
  ]);
  const knownStaff = rosters.flat();
  // The way back leads to where the sheet lives now: its subpage when the
  // reader may open it, else its department. A new sheet opens here straight
  // from the department page, and a push notification lands here with no page behind.
  const home = departments.find((department) => department.id === sheet.currentDepartmentId);
  const homeSubpage = subpageData.subpages.find(
    (subpage) => subpage.id === sheet.subpageId && subpage.capabilities.canView,
  );
  // A reviewer goes back to 審核 (the user, 2026-10-04): when they opened the
  // sheet from it, or when it waits at their own review stage — a notification
  // to it lands here with no page behind. Not its writer who just sent it,
  // even a company-wide reader: their way back is the department.
  const awaitingRole = reviewerRole(user, sheet);
  const backToReview = isCompanyReader(user) && (from === "review" || awaitingRole !== null);
  // 完工紀錄 is the way back only for a sheet opened from it (the user,
  // 2026-10-04), as 審核 is for one opened from 審核. Archiving a sheet on its
  // page leaves its way back alone.
  const history = home && from === "history"
    ? {
        href: `/departments/${home.slug}/history${homeSubpage ? `?subpageId=${homeSubpage.id}` : ""}`,
        label: "完工紀錄",
      }
    : null;
  const back = backToReview
    ? { href: "/sheets", label: "審核" }
    : history
    ? history
    : home
    ? homeSubpage
      ? { href: `/departments/${home.slug}/subpages/${homeSubpage.id}`, label: homeSubpage.name }
      : { href: `/departments/${home.slug}`, label: home.displayName }
    : isCompanyReader(user)
      ? { href: "/sheets", label: "審核" }
      : { href: "/", label: "首頁" };

  const returned = sheet.state === "RETURNED" ? latestRejection(sheet.approvals) : null;

  return (
    <SheetRefreshProvider>
    <SheetVersionProvider>
      <main className="cc-page cc-stack" style={{ margin: "0 auto" }}>
      <MarkNotificationsRead sheetId={sheet.id} />
      <nav className="cc-breadcrumb">
        <Link href="/">首頁</Link>
        <span aria-hidden="true">/</span>
        {home ? (
          <>
            <Link href={`/departments/${home.slug}`}>{home.displayName}</Link>
            {history ? (
              <>
                <span aria-hidden="true">/</span>
                <Link href={history.href}>{history.label}</Link>
              </>
            ) : homeSubpage ? (
              <>
                <span aria-hidden="true">/</span>
                <Link href={`/departments/${home.slug}/subpages/${homeSubpage.id}`}>{homeSubpage.name}</Link>
              </>
            ) : null}
          </>
        ) : (
          <Link href={back.href}>{back.label}</Link>
        )}
        <span aria-hidden="true">/</span>
        <span>{definition.displayName}</span>
      </nav>

      <div className="cc-page__header">
        <div>
          <div className="cc-row" style={{ gap: "var(--cc-space-3)" }}>
            <h1 className="cc-h1">{definition.displayName}</h1>
            <Badge tone={SHEET_STATE_TONE[sheet.state]}>
              {SHEET_STATE_LABEL[sheet.state]}
            </Badge>
          </div>
          <p className="cc-body-sm cc-muted cc-tnum">
            {/* A form that prints no identifier gets no empty separator. */}
            {documentIdentifier === null ? null : `${documentIdentifier} ・ `}
            版本 {sheet.template.version}
          </p>
        </div>
        <Link className="cc-btn cc-btn--secondary" href={back.href}>
          返回{back.label}
        </Link>
      </div>

      {/*
        The subpage's 設定 no longer ticks this form. Anyone who could view the
        sheet still can; only the 主管 may change it until it is moved or the
        tick is restored (DESIGN.md §3.2.24). A finished sheet is read-only
        regardless, so there is nothing to explain there.
      */}
      {!sheet.formEnabledInSubpage && sheet.state !== "COMPLETED" && sheet.state !== "ARCHIVED" ? (
        <Alert tone="warning" title="此子分頁已不再開放這個表單">
          {runsProduction
            ? "目前只有部門主管可以修改或處理這張生產單。請將它移動到已勾選此表單的子分頁，或在子分頁設定中重新勾選。"
            : "這張生產單目前只能檢視。如需繼續作業，請聯絡部門主管。"}
        </Alert>
      ) : null}

      {/*
        分條申請單 is reviewed by 業務, 協理 and 總經理 in turn (the user,
        2026-10-01). A returned sheet shows its reason to the department that
        fixes it; the reviewer whose turn it is decides here.
      */}
      {returned ? (
        <Alert tone="danger" title={`${returned.role} 退回了這張生產單`} assertive>
          <p>{returned.comment}</p>
          <p className="cc-caption" style={{ marginTop: "var(--cc-space-2)" }}>
            {taipei(returned.decidedAt)}・修改後重新送出審核，會從業務開始重新審核。
          </p>
        </Alert>
      ) : null}

      {awaitingRole ? (
        <div className="cc-card">
          <div className="cc-card__header">
            <h2 className="cc-h3">審核</h2>
          </div>
          <div className="cc-card__body">
            <ReviewSheet sheet={sheet} requiredRole={awaitingRole} />
          </div>
        </div>
      ) : null}

      {/*
        封存 and 恢復 sit under 生產狀態, above 儲存 (the user, 2026-10-04), so
        the 主管 does not scroll back up for them. What archiving means for
        this sheet stays here at the top.
      */}
      {sheet.state === "ARCHIVED" ? (
        <Alert tone="info" title="已封存">
          這張生產單已於 {taipei(sheet.archivedAt)} 封存，僅供查閱。
          若未恢復，將於 <strong className="cc-tnum">{taipei(sheetDeletionAt(sheet.archivedAt))}</strong>{" "}
          後連同附件永久刪除，無法復原。
        </Alert>
      ) : null}

      <div className="cc-card">
        <div className="cc-card__body">
          {/* 審核流程 went with review (the user, 2026-09-30). */}
          <SheetDetails
            sheet={sheet}
            user={user}
            subpages={subpageData.subpages}
            formGovernedByTicks={subpageData.eligibleTemplates.some((template) => template.id === sheet.template.id)}
            labels={{
              created: taipei(sheet.createdAt),
              updated: taipei(sheet.updatedAt),
              due: taipei(sheet.dueAt),
            }}
          />
        </div>
      </div>

      <SheetForm
        sheet={sheet}
        user={user}
        departmentHref={home ? `/departments/${home.slug}` : back.href}
      />

      <SheetAttachments sheetId={sheet.id} initialPage={attachments} />

      <div className="cc-card">
        <div className="cc-card__header">
          <h2 className="cc-h3">流轉歷程</h2>
        </div>
        <div className="cc-card__body">
          <SheetHistory
            sheet={sheet}
            user={user}
            departments={departments}
            staff={knownStaff}
          />
        </div>
      </div>

      <div className="cc-card">
        <div className="cc-card__header">
          <h2 className="cc-h3">欄位修改紀錄</h2>
        </div>
        <div className="cc-card__body">
          <FieldHistory
            entries={fieldHistory.items}
            total={fieldHistory.total}
            definition={definition}
          />
        </div>
      </div>

      {/* Review is retired (the user, 2026-09-30); a sheet reviewed before
          keeps its history here. */}
      {sheet.approvals.length > 0 ? (
      <div className="cc-card">
        <div className="cc-card__header">
          <h2 className="cc-h3">審核歷程</h2>
        </div>
        <div className="cc-card__body">
          <ApprovalHistory
            approvals={sheet.approvals}
            requiresReview={definition.workflow.requiresReview}
          />
        </div>
      </div>
      ) : null}
      </main>
    </SheetVersionProvider>
    </SheetRefreshProvider>
  );
}
