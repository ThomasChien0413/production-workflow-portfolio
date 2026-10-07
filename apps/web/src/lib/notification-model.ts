/**
 * Client-safe notification types and labels.
 *
 * Separate from lib/notifications.ts, which imports `next/headers` to fetch.
 */
export type NotificationItem = {
  id: string;
  sheetId: string | null;
  eventType: string;
  summary: string;
  deepLink: string | null;
  state: string;
  deliveredAt: string | null;
  readAt: string | null;
  createdAt: string;
};

export type NotificationPage = {
  items: NotificationItem[];
  page: number;
  pageSize: number;
  total: number;
  /** Unread across the whole history, not just this page — it is the badge. */
  unread: number;
};

/**
 * Event labels.
 *
 * The API sends an event type and a Traditional Chinese summary it wrote at the
 * time; the summary is the message and is shown as-is. This adds the short
 * category label beside it, so a long list can be scanned by kind. Unknown
 * types fall back to the raw code rather than being hidden or guessed at — a
 * new backend event should look unlabelled, not invisible.
 */
export const NOTIFICATION_LABEL: Record<string, string> = {
  SHEET_CREATED: "已建立",
  SHEET_SUBMITTED: "已送審",
  SHEET_REVIEW_REQUIRED: "待你審核",
  SHEET_APPROVAL_PROGRESS: "審核進度",
  SHEET_APPROVED_STAGE: "審核通過",
  SHEET_RETURNED: "已退回",
  SHEET_APPROVAL_INVALIDATED: "核准失效",
  SHEET_READY: "待生產",
  SHEET_ASSIGNED: "已指派",
  SHEET_WORK_STARTED: "開始生產",
  SHEET_WORK_COMPLETED: "已完成",
  SHEET_HANDED_OFF: "已轉送",
  SHEET_ROUTED: "已轉送",
  SHEET_ARCHIVED: "已封存",
  SHEET_OVERDUE: "已逾期",
  SHEET_VALUES_PATCHED: "內容已修改",
};

export const NOTIFICATION_TONE: Record<
  string,
  "neutral" | "info" | "success" | "warning" | "danger"
> = {
  SHEET_REVIEW_REQUIRED: "warning",
  SHEET_RETURNED: "danger",
  SHEET_APPROVAL_INVALIDATED: "danger",
  SHEET_OVERDUE: "danger",
  SHEET_ASSIGNED: "info",
  SHEET_READY: "info",
  SHEET_WORK_STARTED: "info",
  SHEET_APPROVED_STAGE: "success",
  SHEET_WORK_COMPLETED: "success",
  SHEET_ARCHIVED: "neutral",
};

export function notificationLabel(eventType: string): string {
  return NOTIFICATION_LABEL[eventType] ?? eventType;
}

export function notificationTone(eventType: string) {
  return NOTIFICATION_TONE[eventType] ?? "neutral";
}

/**
 * Deep links are written by the API as app-relative paths. Anything else is
 * dropped rather than rendered: a link target that arrived as data should never
 * be able to send someone off-site.
 */
export function safeDeepLink(deepLink: string | null): string | null {
  if (!deepLink) return null;
  return deepLink.startsWith("/") && !deepLink.startsWith("//") ? deepLink : null;
}
