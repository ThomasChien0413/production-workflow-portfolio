import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { DepartmentSheetHistorySort } from "@workflow/contracts";
import { Badge, Card, ScrollRegion } from "@workflow/ui";
import { managesDepartment } from "@workflow/domain";
import { getDepartmentBySlug } from "@/lib/departments";
import { getSessionUser } from "@/lib/session";
import { actorOf } from "@/lib/sheet-permissions";
import { listDepartmentSheetHistory } from "@/lib/sheet-history";
import {
  DEFAULT_HISTORY_SORT,
  HISTORY_SORT_LABEL,
  describeHistorySort,
  historyAriaSort,
  nextHistorySort,
  parseHistorySort,
  type HistorySort,
} from "@/lib/sheet-history-model";
import { SHEET_STATE_LABEL, SHEET_STATE_TONE } from "@/lib/sheet-model";
import { sheetDeletionAt } from "@/lib/retention";
import { asCalendarDate } from "@/lib/taipei";
import { HistoryFilters } from "./history-filters";
import { HistoryPdfDownload } from "./history-pdf-download";
import { HistoryDelete } from "./history-delete";
import { HistoryRestore } from "./history-restore";

export const metadata: Metadata = { title: "完工紀錄 · Workflow Portfolio" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function uuid(value: string | string[] | undefined): string | undefined {
  const candidate = text(value);
  return candidate && UUID.test(candidate) ? candidate : undefined;
}

function taipei(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-Hant-TW", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Taipei",
  }).format(new Date(value));
}

export default async function DepartmentHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, raw, user] = await Promise.all([
    params,
    searchParams,
    getSessionUser(),
  ]);
  if (!user) redirect("/login");

  const department = await getDepartmentBySlug(slug);
  if (!department) notFound();

  const qCandidate = text(raw["q"]);
  const q = qCandidate && qCandidate.length <= 128 ? qCandidate : undefined;
  const templateId = uuid(raw["templateId"]);
  const subpageId = uuid(raw["subpageId"]);
  const from = asCalendarDate(text(raw["from"]));
  const rawTo = asCalendarDate(text(raw["to"]));
  const to = from && rawTo && rawTo < from ? undefined : rawTo;
  const pageCandidate = Number(text(raw["page"]) ?? "1");
  const page =
    Number.isInteger(pageCandidate) && pageCandidate > 0 && pageCandidate <= 10_000
      ? pageCandidate
      : 1;
  const sort = parseHistorySort(raw["sort"], raw["direction"]);

  const results = await listDepartmentSheetHistory(department.id, {
    q,
    templateId,
    subpageId,
    from,
    to,
    page,
    sort: sort.key,
    direction: sort.direction,
  });
  const lastPage = Math.max(1, Math.ceil(results.total / results.pageSize));
  // The department's 主管 brings an archived sheet back, or deletes it at once
  // (the user, 2026-10-04).
  const restores = managesDepartment(actorOf(user), department.id);
  const basePath = `/departments/${department.slug}/history`;

  const href = ({
    targetPage = results.page,
    targetSort = sort,
  }: {
    targetPage?: number;
    targetSort?: HistorySort;
  } = {}) => {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    if (templateId) query.set("templateId", templateId);
    if (subpageId) query.set("subpageId", subpageId);
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    if (targetSort.key !== DEFAULT_HISTORY_SORT.key) query.set("sort", targetSort.key);
    if (
      targetSort.direction !== DEFAULT_HISTORY_SORT.direction ||
      targetSort.key !== DEFAULT_HISTORY_SORT.key
    ) {
      query.set("direction", targetSort.direction);
    }
    if (targetPage > 1) query.set("page", String(targetPage));
    const suffix = query.toString();
    return suffix === "" ? basePath : `${basePath}?${suffix}`;
  };

  return (
    <main className="cc-page cc-stack" style={{ margin: "0 auto" }}>
      <nav className="cc-breadcrumb">
        <Link href="/">首頁</Link>
        <span aria-hidden="true">/</span>
        <Link href={`/departments/${department.slug}`}>{department.displayName}</Link>
        <span aria-hidden="true">/</span>
        <span>完工紀錄</span>
      </nav>

      <div className="cc-page__header">
        <div>
          <h1 className="cc-h1">{department.displayName}・完工紀錄</h1>
          <p className="cc-body-sm cc-muted">
            共 {results.total} 筆完工紀錄・第 {results.page} / {lastPage} 頁
          </p>
        </div>
        <Link className="cc-btn cc-btn--secondary" href={`/departments/${department.slug}`}>
          返回部門
        </Link>
      </div>

      <p className="cc-body-sm cc-secondary">
        僅顯示目前位於本部門、已封存的生產單。已完成但尚未封存的生產單仍在子分頁中。部門主管可將已封存的生產單恢復到原本的子分頁，狀態回到已完成。
      </p>

      <Card header={<h2 className="cc-h3">搜尋與篩選</h2>}>
        <HistoryFilters
          key={JSON.stringify({ q, templateId, subpageId, from, to, sort })}
          basePath={basePath}
          q={q}
          templateId={templateId}
          subpageId={subpageId}
          from={from}
          to={to}
          sort={sort}
          templates={results.filterOptions.templates}
          subpages={results.filterOptions.subpages}
        />
      </Card>

      {results.items.length === 0 ? (
        <Card>
          <div className="cc-empty">
            <p className="cc-empty__title">找不到符合條件的完工紀錄</p>
            <p className="cc-empty__text">
              調整或清除搜尋條件後再試一次。搜尋只使用已儲存的表單內容。
            </p>
          </div>
        </Card>
      ) : (
        <>
          <ScrollRegion label="部門完工紀錄" className="cc-only-wide">
            <table className="cc-table">
              <caption className="cc-sr-only">
                {department.displayName} 完工紀錄，共 {results.total} 筆，{describeHistorySort(sort)}
              </caption>
              <thead>
                <tr>
                  <SortableHeader sort={sort} column="template" href={href({ targetPage: 1, targetSort: nextHistorySort(sort, "template") })} />
                  <th scope="col">子分頁</th>
                  <SortableHeader sort={sort} column="completedAt" href={href({ targetPage: 1, targetSort: nextHistorySort(sort, "completedAt") })} />
                  <th scope="col">封存時間</th>
                  <th scope="col"><span className="cc-sr-only">操作</span></th>
                </tr>
              </thead>
              <tbody>
                {results.items.map((sheet) => (
                  <tr key={sheet.id}>
                    <td>{sheet.template.displayName}</td>
                    <td>{sheet.subpage.name}</td>
                    <td className="cc-tnum" style={{ whiteSpace: "nowrap" }}>
                      {taipei(sheet.completedAt)}
                    </td>
                    <td className="cc-tnum cc-muted" style={{ whiteSpace: "nowrap" }}>
                      {taipei(sheet.archivedAt)}
                      {sheet.archivedAt ? (
                        <span className="cc-caption" style={{ display: "block" }}>
                          {taipei(sheetDeletionAt(sheet.archivedAt))} 刪除
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <span className="cc-row" style={{ flexWrap: "nowrap" }}>
                        <Link className="cc-btn cc-btn--tertiary" href={`/sheets/${sheet.id}?from=history`}>
                          開啟<span className="cc-sr-only">：{sheet.template.displayName}</span>
                        </Link>
                        <HistoryPdfDownload sheetId={sheet.id} label={sheet.template.displayName} />
                        {restores && sheet.state === "ARCHIVED" ? (
                          <>
                            <HistoryRestore sheetId={sheet.id} label={sheet.template.displayName} />
                            <HistoryDelete sheetId={sheet.id} label={sheet.template.displayName} />
                          </>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>

          <p className="cc-sr-only cc-only-narrow">
            {department.displayName} 完工紀錄，共 {results.total} 筆，{describeHistorySort(sort)}
          </p>
          <div className="cc-only-narrow cc-stack" style={{ gap: "var(--cc-space-3)" }}>
            {results.items.map((sheet) => (
              <article key={sheet.id} className="cc-sheet-card cc-sheet-card--done">
                <div className="cc-sheet-card__top">
                  <span className="cc-sheet-card__name">{sheet.template.displayName}</span>
                  <Badge tone={SHEET_STATE_TONE[sheet.state]}>
                    {SHEET_STATE_LABEL[sheet.state]}
                  </Badge>
                </div>
                <dl className="cc-sheet-card__meta">
                  <dt>子分頁</dt>
                  <dd>{sheet.subpage.name}</dd>
                  <dt>完成時間</dt>
                  <dd className="cc-tnum">{taipei(sheet.completedAt)}</dd>
                  <dt>封存時間</dt>
                  <dd className="cc-tnum">{taipei(sheet.archivedAt)}</dd>
                  {sheet.archivedAt ? (
                    <>
                      <dt>刪除時間</dt>
                      <dd className="cc-tnum">{taipei(sheetDeletionAt(sheet.archivedAt))}</dd>
                    </>
                  ) : null}
                </dl>
                <div className="cc-row" style={{ marginTop: "var(--cc-space-3)" }}>
                  <Link className="cc-btn cc-btn--secondary" href={`/sheets/${sheet.id}?from=history`}>
                    開啟<span className="cc-sr-only">：{sheet.template.displayName}</span>
                  </Link>
                  <HistoryPdfDownload sheetId={sheet.id} label={sheet.template.displayName} />
                  {restores && sheet.state === "ARCHIVED" ? (
                    <>
                      <HistoryRestore sheetId={sheet.id} label={sheet.template.displayName} />
                      <HistoryDelete sheetId={sheet.id} label={sheet.template.displayName} />
                    </>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      {lastPage > 1 ? (
        <nav className="cc-row" aria-label="完工紀錄分頁">
          {results.page > 1 ? (
            <Link className="cc-btn cc-btn--secondary" href={href({ targetPage: results.page - 1 })}>
              上一頁
            </Link>
          ) : null}
          <span className="cc-body-sm cc-muted cc-tnum">
            第 {results.page} / {lastPage} 頁
          </span>
          {results.page < lastPage ? (
            <Link className="cc-btn cc-btn--secondary" href={href({ targetPage: results.page + 1 })}>
              下一頁
            </Link>
          ) : null}
        </nav>
      ) : null}
    </main>
  );
}

function SortableHeader({
  sort,
  column,
  href,
}: {
  sort: HistorySort;
  column: DepartmentSheetHistorySort;
  href: string;
}) {
  const active = sort.key === column;
  const next = nextHistorySort(sort, column);
  const intent = next.direction === "asc" ? "正向" : "反向";
  return (
    <th scope="col" aria-sort={historyAriaSort(sort, column)}>
      <Link
        className={`cc-th-sort${active ? " cc-th-sort--active" : ""}`}
        href={href}
        aria-label={`${HISTORY_SORT_LABEL[column]}，改為${intent}排序`}
      >
        {HISTORY_SORT_LABEL[column]}
        <span className="cc-th-sort__arrow" aria-hidden="true">
          {active ? (sort.direction === "asc" ? "▲" : "▼") : "▲▼"}
        </span>
      </Link>
    </th>
  );
}
