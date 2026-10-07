import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge, Card } from "@workflow/ui";
import { changesOwnPassword } from "@workflow/domain";
import {
  getAdminUser,
  listAdminDepartments,
  listAdminRoles,
} from "@/lib/admin";
import { getSessionUser } from "@/lib/session";
import { DeactivateUser } from "./deactivate-user";
import { EditUserForm } from "./edit-user-form";
import { ResetPasswordForm } from "./reset-password-form";
import { customLoginName } from "@/lib/login-name";

export const metadata: Metadata = { title: "帳號詳細 · Workflow Portfolio" };

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const [user, roles, departments, sessionUser] = await Promise.all([
    getAdminUser(userId),
    listAdminRoles(),
    listAdminDepartments(),
    getSessionUser(),
  ]);

  if (!user) notFound();
  const isSelf = sessionUser?.id === user.id;

  return (
    <div className="cc-stack" style={{ maxWidth: "var(--cc-content-max)" }}>
      <div className="cc-page__header">
        <div>
          <div className="cc-row" style={{ gap: "var(--cc-space-3)" }}>
            <h1 className="cc-h1">{user.displayName}</h1>
            {user.active ? (
              <Badge tone="success">啟用中</Badge>
            ) : (
              <Badge tone="neutral" dot>
                已停用
              </Badge>
            )}
          </div>
          {customLoginName(user) ? <p className="cc-body-sm cc-muted" style={{ overflowWrap: "anywhere" }}>登入名稱：{customLoginName(user)}</p> : null}
        </div>
        <Link className="cc-btn cc-btn--secondary" href="/admin/users">
          返回清單
        </Link>
      </div>

      {user.passwordWarning ? (
        <Alert tone="warning" title="此帳號仍使用初始密碼">
          使用者尚未變更密碼，登入後會持續看到安全提示。
        </Alert>
      ) : null}

      <Card header={<h2 className="cc-h3">帳號設定</h2>}>
        <EditUserForm
          user={user}
          roles={roles}
          departments={departments}
          isSelf={isSelf}
        />
      </Card>

      {/* Phone and browser push replaced LINE (the user, 2026-10-04). */}
      <Card header={<h2 className="cc-h3">通知裝置</h2>}>
        {user.pushDevices.count === 0 ? (
          <p className="cc-body-sm cc-secondary">
            尚未在任何裝置開啟通知，只能在「通知」頁面看到提醒。請對方到「設定」開啟。
          </p>
        ) : (
          <dl className="cc-sheet-card__meta">
            <dt>已開啟的裝置</dt>
            <dd className="cc-tnum">{user.pushDevices.count} 台</dd>
            <dt>最近一次送達</dt>
            <dd className="cc-tnum">
              {user.pushDevices.lastSuccessAt
                ? new Intl.DateTimeFormat("zh-Hant-TW", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Taipei" }).format(new Date(user.pushDevices.lastSuccessAt))
                : "—"}
            </dd>
          </dl>
        )}
        <p className="cc-help" style={{ marginTop: "var(--cc-space-3)" }}>
          只顯示裝置數量。裝置位址與金鑰不會出現在管理介面中。
        </p>
      </Card>

      <Card header={<h2 className="cc-h3">重設密碼</h2>}>
        <p
          className="cc-body-sm cc-secondary"
          style={{ marginBottom: "var(--cc-space-4)" }}
        >
          {/* Only ADMIN and 總經理 change their own password (the user, 2026-10-04). */}
          {changesOwnPassword(user)
            ? `重設會立即結束 ${user.displayName} 的所有工作階段，並重新顯示變更密碼提示。`
            : `重設會立即結束 ${user.displayName} 的所有工作階段。對方無法自行變更密碼，請直接告知新密碼。`}
        </p>
        <ResetPasswordForm userId={user.id} displayName={user.displayName} />
      </Card>

      <Card header={<h2 className="cc-h3">停用帳號</h2>}>
        <DeactivateUser user={user} isSelf={isSelf} />
      </Card>
    </div>
  );
}
