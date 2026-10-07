import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, ScrollRegion } from "@workflow/ui";
import { getSessionUser } from "@/lib/session";
import { searchAudit } from "@/lib/audit";
import { asCalendarDate } from "@/lib/taipei";
import { AuditFilters } from "./audit-filters";
import { customLoginName } from "@/lib/login-name";

export const metadata: Metadata = { title: "稽核紀錄 · Workflow Portfolio" };

function taipei(value: string): string {
  return new Intl.DateTimeFormat("zh-Hant-TW", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Asia/Taipei",
  }).format(new Date(value));
}

function text(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [user, params] = await Promise.all([getSessionUser(), searchParams]);
  if (!user) redirect("/login");
  // Audit administration is ADMIN-only, narrower than account management.
  if (!user.roles.includes("ADMIN")) redirect("/admin/users");

  const q = text(params["q"]);
  const action = text(params["action"]);
  const targetType = text(params["targetType"]);
  // A hand-edited or truncated link is a normal way to arrive here, so a date
  // that is not a real day is dropped rather than passed on to fail at the API.
  const from = asCalendarDate(text(params["from"]));
  const rawTo = asCalendarDate(text(params["to"]));
  // An inverted range is a 400 at the API. Ignoring the end is the reading that
  // still answers the question the operator was asking.
  const to = from && rawTo && rawTo < from ? undefined : rawTo;
  const pageParam = Number(text(params["page"]) ?? "1");
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

  const results = await searchAudit({ page, q, action, targetType, from, to });
  const lastPage = Math.max(1, Math.ceil(results.total / results.pageSize));

  const pageHref = (target: number) => {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    if (action) query.set("action", action);
    if (targetType) query.set("targetType", targetType);
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    if (target > 1) query.set("page", String(target));
    const suffix = query.toString();
    return suffix === "" ? "/admin/audit" : `/admin/audit?${suffix}`;
  };

  return (
    <div className="cc-stack">
      <div className="cc-page__header">
        <div>
          <h1 className="cc-h1">稽核紀錄</h1>
          <p className="cc-body-sm cc-muted">
            共 {results.total} 筆・第 {results.page} / {lastPage} 頁
          </p>
        </div>
      </div>

      <p className="cc-body-sm cc-secondary">
        每一筆材料異動、權限變更、審核、轉送、認證安全事件與通知結果都會留下紀錄。
        紀錄本身不可修改，也不包含生產單的欄位內容或任何機密值。
      </p>

      <AuditFilters
        q={q}
        action={action}
        targetType={targetType}
        from={from}
        to={to}
      />

      {results.items.length === 0 ? (
        <Card>
          <div className="cc-empty">
            <p className="cc-empty__title">沒有符合的紀錄</p>
            <p className="cc-empty__text">
              調整或清除搜尋條件後再試一次。時間以 Asia/Taipei 顯示。
            </p>
          </div>
        </Card>
      ) : (
        <>
          <ScrollRegion label="稽核紀錄，最新的在最前面" className="cc-only-wide">
            <table className="cc-table">
              <caption className="cc-sr-only">稽核紀錄，最新的在最前面</caption>
              <thead>
                <tr>
                  <th scope="col">時間</th>
                  <th scope="col">操作</th>
                  <th scope="col">執行者</th>
                  <th scope="col">對象</th>
                  <th scope="col">細節</th>
                </tr>
              </thead>
              <tbody>
                {results.items.map((event) => (
                  <tr key={event.id}>
                    <td className="cc-tnum" style={{ whiteSpace: "nowrap" }}>
                      {taipei(event.createdAt)}
                    </td>
                    <td>{event.action}</td>
                    <td>
                      {event.actor ? (
                        <>
                          {event.actor.displayName}
                          {customLoginName(event.actor) ? <span className="cc-caption cc-muted" style={{ overflowWrap: "anywhere" }}>
                            {" "}
                            ・登入名稱：{customLoginName(event.actor)}
                          </span> : null}
                        </>
                      ) : (
                        <span className="cc-muted">系統</span>
                      )}
                    </td>
                    <td className="cc-caption">
                      {event.targetType}
                      {event.targetId ? (
                        <span className="cc-tnum cc-muted"> {event.targetId}</span>
                      ) : null}
                    </td>
                    <td>
                      <Metadata metadata={event.metadata} requestId={event.requestId} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>

          <div className="cc-only-narrow cc-stack" style={{ gap: "var(--cc-space-3)" }}>
            {results.items.map((event) => (
              <article key={event.id} className="cc-sheet-card" style={{ overflowWrap: "anywhere" }}>
                <div className="cc-sheet-card__top">
                  <span className="cc-sheet-card__no" style={{ minWidth: 0 }}>{event.action}</span>
                  <span className="cc-caption cc-tnum">{taipei(event.createdAt)}</span>
                </div>
                <dl className="cc-sheet-card__meta" style={{ gridTemplateColumns: "auto minmax(0, 1fr)" }}>
                  <dt>執行者</dt>
                  <dd>{event.actor ? event.actor.displayName : "系統"}</dd>
                  <dt>對象</dt>
                  <dd className="cc-caption">
                    {event.targetType}
                    {event.targetId ? ` ${event.targetId}` : ""}
                  </dd>
                </dl>
                <Metadata metadata={event.metadata} requestId={event.requestId} />
              </article>
            ))}
          </div>
        </>
      )}

      {lastPage > 1 ? (
        <nav className="cc-row" aria-label="分頁">
          {results.page > 1 ? (
            <Link className="cc-btn cc-btn--secondary" href={pageHref(results.page - 1)}>
              上一頁
            </Link>
          ) : null}
          <span className="cc-body-sm cc-muted cc-tnum">
            第 {results.page} / {lastPage} 頁
          </span>
          {results.page < lastPage ? (
            <Link className="cc-btn cc-btn--secondary" href={pageHref(results.page + 1)}>
              下一頁
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}

/**
 * Metadata is already sanitised by the API before it leaves the process, and
 * redacted keys arrive as the literal string `[REDACTED]`. It is rendered as
 * plain key/value text rather than raw JSON so an administrator can read it
 * without parsing braces.
 */
function Metadata({
  metadata,
  requestId,
}: {
  metadata: Record<string, unknown>;
  requestId: string | null;
}) {
  const entries = Object.entries(metadata);
  if (entries.length === 0 && !requestId) {
    return <span className="cc-muted">—</span>;
  }
  return (
    <div className="cc-caption cc-stack" style={{ gap: "var(--cc-space-1)" }}>
      {entries.map(([key, value]) => (
        <div key={key}>
          <span className="cc-muted">{key}：</span>
          <span style={{ wordBreak: "break-all" }}>{describe(value)}</span>
        </div>
      ))}
      {requestId ? (
        <div>
          <span className="cc-muted">requestId：</span>
          <span className="cc-tnum" style={{ overflowWrap: "anywhere" }}>
            {requestId}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function describe(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.map(describe).join("、");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
