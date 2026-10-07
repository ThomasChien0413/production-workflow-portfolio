import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card } from "@workflow/ui";
import { getSessionUser } from "@/lib/session";
import {
  listNotifications,
  notificationLabel,
  notificationTone,
  safeDeepLink,
} from "@/lib/notifications";
import { MarkAllRead, MarkRead } from "./notification-actions";

export const metadata: Metadata = { title: "通知 · Workflow Portfolio" };

function taipei(value: string): string {
  return new Intl.DateTimeFormat("zh-Hant-TW", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Taipei",
  }).format(new Date(value));
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [user, params] = await Promise.all([getSessionUser(), searchParams]);
  if (!user) redirect("/login");

  const unreadOnly = params["unread"] === "1";
  const page = Number(params["page"] ?? "1");
  const notifications = await listNotifications({
    page: Number.isFinite(page) && page > 0 ? page : 1,
    unreadOnly,
  });

  const lastPage = Math.max(
    1,
    Math.ceil(notifications.total / notifications.pageSize),
  );
  const query = (target: number) =>
    `/notifications?${new URLSearchParams({
      ...(unreadOnly ? { unread: "1" } : {}),
      ...(target > 1 ? { page: String(target) } : {}),
    }).toString()}`;

  return (
    <main className="cc-page cc-stack" style={{ margin: "0 auto" }}>
      <nav className="cc-breadcrumb">
        <Link href="/">首頁</Link>
        <span aria-hidden="true">/</span>
        <span>通知</span>
      </nav>

      <div className="cc-page__header">
        <div>
          <h1 className="cc-h1">通知</h1>
          <p className="cc-body-sm cc-muted">
            共 {notifications.total} 則・未讀 {notifications.unread} 則
          </p>
        </div>
        <MarkAllRead unread={notifications.unread} />
      </div>

      {/*
        A filter, not a separate screen. The unread view is where someone starts
        their shift; the full history is what they check when they are looking
        for something that already happened.
      */}
      <div className="cc-row" role="group" aria-label="篩選">
        <Link
          className={`cc-btn ${unreadOnly ? "cc-btn--secondary" : "cc-btn--primary"}`}
          href="/notifications"
          aria-current={unreadOnly ? undefined : "page"}
        >
          全部
        </Link>
        <Link
          className={`cc-btn ${unreadOnly ? "cc-btn--primary" : "cc-btn--secondary"}`}
          href="/notifications?unread=1"
          aria-current={unreadOnly ? "page" : undefined}
        >
          僅未讀
          {notifications.unread > 0 ? (
            <span className="cc-count">{notifications.unread}</span>
          ) : null}
        </Link>
      </div>

      {notifications.items.length === 0 ? (
        <Card>
          <div className="cc-empty">
            <p className="cc-empty__title">
              {unreadOnly ? "沒有未讀通知" : "還沒有任何通知"}
            </p>
            <p className="cc-empty__text">
              {unreadOnly
                ? "所有通知都已讀取。"
                : "當生產單需要你審核、需要你放入子分頁，或已逾期時，通知會出現在這裡，開啟通知的裝置也會跳出提醒。"}
            </p>
          </div>
        </Card>
      ) : (
        <ul className="cc-stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {notifications.items.map((item) => {
            const link = safeDeepLink(item.deepLink);
            const unread = item.readAt === null;
            return (
              <li key={item.id}>
                <article
                  className="cc-sheet-card"
                  style={
                    unread
                      ? { borderInlineStartColor: "var(--cc-border-accent)" }
                      : undefined
                  }
                >
                  <div className="cc-sheet-card__top">
                    <span className="cc-row" style={{ gap: "var(--cc-space-2)" }}>
                      <Badge tone={notificationTone(item.eventType)}>
                        {notificationLabel(item.eventType)}
                      </Badge>
                      {unread ? (
                        <Badge tone="info" dot>
                          未讀
                        </Badge>
                      ) : null}
                    </span>
                    <span className="cc-sheet-card__no cc-tnum">
                      {taipei(item.createdAt)}
                    </span>
                  </div>

                  <p className="cc-body" style={{ margin: "var(--cc-space-2) 0" }}>
                    {item.summary}
                  </p>

                  <div className="cc-row">
                    {link ? (
                      <Link className="cc-btn cc-btn--tertiary" href={link}>
                        開啟生產單
                      </Link>
                    ) : null}
                    {unread ? <MarkRead notificationId={item.id} /> : null}
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}

      {lastPage > 1 ? (
        <nav className="cc-row" aria-label="分頁">
          {notifications.page > 1 ? (
            <Link className="cc-btn cc-btn--secondary" href={query(notifications.page - 1)}>
              上一頁
            </Link>
          ) : null}
          <span className="cc-body-sm cc-muted cc-tnum">
            第 {notifications.page} / {lastPage} 頁
          </span>
          {notifications.page < lastPage ? (
            <Link className="cc-btn cc-btn--secondary" href={query(notifications.page + 1)}>
              下一頁
            </Link>
          ) : null}
        </nav>
      ) : null}

      <p className="cc-caption cc-muted">
        開啟通知的手機或電腦會同時跳出提醒。沒有收到的話，請到「設定」確認此裝置已開啟通知。
      </p>
    </main>
  );
}
