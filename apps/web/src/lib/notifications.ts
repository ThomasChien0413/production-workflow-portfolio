import { apiOptional, apiRequire } from "./api";
import type { NotificationPage } from "./notification-model";

export * from "./notification-model";

const EMPTY: NotificationPage = {
  items: [],
  page: 1,
  pageSize: 30,
  total: 0,
  unread: 0,
};

/**
 * The signed-in user's own in-app notification history.
 *
 * Server-only: the API scopes every row to the caller's session, so there is no
 * user id to pass and no way to ask for someone else's.
 *
 * Required: this screen exists to answer "is anything waiting for me?", and
 * answering "no" when the truth is "we could not ask" is the wrong answer.
 */
export async function listNotifications(params: {
  page?: number;
  unreadOnly?: boolean;
}): Promise<NotificationPage> {
  const query = new URLSearchParams();
  if (params.page && params.page > 1) query.set("page", String(params.page));
  if (params.unreadOnly) query.set("unreadOnly", "true");
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const body = await apiRequire<NotificationPage>(`/api/notifications${suffix}`);
  return body ?? EMPTY;
}

/**
 * Just the badge number, for the navigation.
 *
 * Optional, unlike the list: the shell renders on every signed-in page, and a
 * missing count must not take down a screen that has nothing to do with
 * notifications. A count that fails simply does not appear.
 */
export async function unreadNotificationCount(): Promise<number> {
  const page = await apiOptional<NotificationPage>(
    "/api/notifications?unreadOnly=true",
    EMPTY,
  );
  return page.unread;
}
