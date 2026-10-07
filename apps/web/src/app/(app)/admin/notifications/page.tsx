import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Badge, Card, ScrollRegion } from "@workflow/ui";
import { cookies } from "next/headers";
import { apiOrigin, getSessionUser } from "@/lib/session";

export const metadata: Metadata = { title: "通知健康狀態 · Workflow Portfolio" };

type StateCounts = Record<string, number>;

type Health = {
  generatedAt: string;
  pushDevices: { activeUsers: number; usersWithDevice: number; devices: number };
  pushDeliveries: StateCounts;
  outbox: StateCounts;
  recentFailures: {
    notificationId: string;
    recipientUserId: string;
    recipientUsername: string;
    recipientDisplayName: string;
    eventType: string;
    summary: string;
    createdAt: string;
    lastAttemptAt: string | null;
    lastOutcome: string | null;
  }[];
};

function taipei(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-Hant-TW", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Taipei",
  }).format(new Date(value));
}

async function getHealth(): Promise<Health | null> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();
  if (cookieHeader === "") return null;
  try {
    const response = await fetch(`${apiOrigin}/api/admin/notifications/health`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as Health;
  } catch {
    return null;
  }
}

/** Why a notice did not reach any device, in words an administrator acts on. */
const OUTCOME_LABEL: Record<string, string> = {
  NO_DEVICE: "未開啟通知",
  RECIPIENT_INACTIVE: "帳號已停用",
  RETRIES_EXHAUSTED: "多次重試失敗",
  TERMINAL_FAILURE: "推播服務拒絕",
};

const DELIVERY_LABEL: Record<string, string> = {
  PENDING: "待送出",
  DELIVERED: "已送達",
  FAILED: "失敗",
  READ: "已讀",
};

const OUTBOX_LABEL: Record<string, string> = {
  PENDING: "待處理",
  PROCESSING: "處理中",
  COMPLETED: "已完成",
  FAILED: "失敗",
};

export default async function NotificationHealthPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!user.roles.includes("ADMIN")) redirect("/admin/users");

  const health = await getHealth();

  return (
    <div className="cc-stack">
      <div className="cc-page__header">
        <div>
          <h1 className="cc-h1">通知健康狀態</h1>
          <p className="cc-body-sm cc-muted">
            {health ? `統計於 ${taipei(health.generatedAt)}` : "目前無法讀取"}
          </p>
        </div>
      </div>

      <p className="cc-body-sm cc-secondary">
        手機與電腦推播即使送不出去也會留下紀錄，因此這裡的失敗數字是真實的投遞結果，
        不是估計值。沒有開啟通知裝置的使用者仍可使用系統，只是看不到跳出的提醒，需要到「通知」頁面查看。
      </p>

      {!health ? (
        <Card>
          <div className="cc-empty">
            <p className="cc-empty__title">無法讀取健康狀態</p>
            <p className="cc-empty__text">請稍後重新整理，或確認 API 是否正常運作。</p>
          </div>
        </Card>
      ) : (
        <>
          {/* Phone and browser push replaced LINE (the user, 2026-10-04). */}
          <Card header={<h2 className="cc-h3">通知裝置</h2>}>
            <CountRow
              counts={{
                ACTIVE: health.pushDevices.activeUsers,
                WITH_DEVICE: health.pushDevices.usersWithDevice,
                WITHOUT_DEVICE: health.pushDevices.activeUsers - health.pushDevices.usersWithDevice,
                DEVICES: health.pushDevices.devices,
              }}
              labels={{ ACTIVE: "啟用中的帳號", WITH_DEVICE: "已開啟通知", WITHOUT_DEVICE: "尚未開啟", DEVICES: "裝置總數" }}
              attention={["WITHOUT_DEVICE"]}
            />
          </Card>

          <Card header={<h2 className="cc-h3">推播投遞</h2>}>
            <CountRow counts={health.pushDeliveries} labels={DELIVERY_LABEL} attention={["FAILED"]} />
          </Card>

          <Card header={<h2 className="cc-h3">派送佇列</h2>}>
            <CountRow counts={health.outbox} labels={OUTBOX_LABEL} attention={["FAILED"]} />
          </Card>

          <Card header={<h2 className="cc-h3">最近的投遞失敗</h2>}>
            {health.recentFailures.length === 0 ? (
              <p className="cc-body-sm cc-muted">目前沒有失敗的推播。</p>
            ) : (
              <ScrollRegion label="最近的推播失敗">
                <table className="cc-table">
                  <caption className="cc-sr-only">最近的推播失敗</caption>
                  <thead>
                    <tr>
                      <th scope="col">收件者</th>
                      <th scope="col">事件</th>
                      <th scope="col">內容</th>
                      <th scope="col">建立時間</th>
                      <th scope="col">原因</th>
                      <th scope="col">最後嘗試</th>
                    </tr>
                  </thead>
                  <tbody>
                    {health.recentFailures.map((failure) => (
                      <tr key={failure.notificationId}>
                        <td>
                          {failure.recipientDisplayName}
                          <span className="cc-caption cc-muted">
                            {" "}
                            ・{failure.recipientUsername}
                          </span>
                        </td>
                        <td className="cc-caption">{failure.eventType}</td>
                        <td className="cc-body-sm">{failure.summary}</td>
                        <td className="cc-tnum cc-muted">{taipei(failure.createdAt)}</td>
                        <td className="cc-body-sm">
                          {failure.lastOutcome ? (OUTCOME_LABEL[failure.lastOutcome] ?? failure.lastOutcome) : "—"}
                        </td>
                        <td className="cc-tnum cc-muted">
                          {taipei(failure.lastAttemptAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollRegion>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

/**
 * Counts by state. Zero is shown rather than hidden — "0 failed" is the
 * reassurance an administrator opened this page for, and a missing row would
 * read as missing data.
 */
function CountRow({
  counts,
  labels,
  attention,
}: {
  counts: StateCounts;
  labels: Record<string, string>;
  attention: string[];
}) {
  const entries = Object.entries(counts);
  if (entries.length === 0) {
    return <p className="cc-body-sm cc-muted">尚無資料。</p>;
  }
  return (
    <div className="cc-row" style={{ gap: "var(--cc-space-4)" }}>
      {entries.map(([state, value]) => (
        <div key={state}>
          <p className="cc-overline">{labels[state] ?? state}</p>
          <p className="cc-h2 cc-tnum" style={{ marginTop: "var(--cc-space-1)" }}>
            {value}
            {value > 0 && attention.includes(state) ? (
              <Badge tone="danger">需要處理</Badge>
            ) : null}
          </p>
        </div>
      ))}
    </div>
  );
}
