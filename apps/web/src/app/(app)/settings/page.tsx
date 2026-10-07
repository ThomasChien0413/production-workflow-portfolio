import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert, Badge, Card } from "@workflow/ui";
import { membershipKindLabels, roleLabels } from "@workflow/contracts";
import { changesOwnPassword } from "@workflow/domain";
import { getSessionUser } from "@/lib/session";
import { SignOutButton } from "@/components/sign-out-button";
import { PushSettings } from "./push-settings";
import { customLoginName } from "@/lib/login-name";

export const metadata: Metadata = { title: "設定 · Workflow Portfolio" };

/**
 * The signed-in user's own account.
 *
 * Deliberately read-only apart from the password and signing out. Roles and
 * department memberships decide what a person may approve, so they are changed
 * by an account manager and recorded in the audit log — never self-served
 * (AGENTS.md §5).
 */
export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const manages =
    user.roles.includes("ADMIN") || user.roles.includes("GENERAL_MANAGER");

  return (
    <main className="cc-page cc-stack" style={{ margin: "0 auto" }}>
      <nav className="cc-breadcrumb">
        <Link href="/">首頁</Link>
        <span aria-hidden="true">/</span>
        <span>設定</span>
      </nav>

      <div className="cc-page__header">
        <div>
          <h1 className="cc-h1">設定</h1>
          <p className="cc-body-sm cc-muted">管理你自己的帳號。</p>
        </div>
        <SignOutButton variant="danger" />
      </div>

      {user.passwordWarning ? (
        <Alert
          tone="danger"
          title="此帳號仍使用預設密碼"
          assertive
          actions={
            <Link className="cc-btn cc-btn--danger" href="/change-password">
              立即變更密碼
            </Link>
          }
        >
          預設密碼為已知的啟用憑證，並非機密。變更後將登出其他所有工作階段。
        </Alert>
      ) : null}

      <Card header={<h2 className="cc-h3">個人資料</h2>}>
        <dl className="cc-deflist">
          <dt>姓名</dt>
          <dd>{user.displayName}</dd>
          {customLoginName(user) ? <><dt>登入名稱</dt><dd style={{ overflowWrap: "anywhere" }}>{customLoginName(user)}</dd></> : null}
        </dl>
        <p className="cc-caption cc-muted" style={{ marginTop: "var(--cc-space-3)" }}>
          姓名由系統管理員或總經理維護。預設使用姓名登入；同名者使用另設的登入名稱。需要更改請與他們聯絡。
        </p>
      </Card>

      {/* Phone and browser push replaced LINE (the user, 2026-10-04). */}
      <section id="notifications" aria-labelledby="notifications-title">
        <Card header={<h2 className="cc-h3" id="notifications-title">通知</h2>}>
          <PushSettings />
        </Card>
      </section>

      <Card header={<h2 className="cc-h3">你的權限</h2>}>
        <div className="cc-stack">
          <div>
            <p className="cc-overline">系統角色</p>
            <div className="cc-row" style={{ marginTop: "var(--cc-space-2)" }}>
              {user.roles.length === 0 ? (
                <p className="cc-body-sm cc-muted">尚未指派系統角色。</p>
              ) : (
                user.roles.map((role) => (
                  <Badge key={role} tone="info">
                    {roleLabels[role]}
                  </Badge>
                ))
              )}
            </div>
          </div>

          <div>
            <p className="cc-overline">部門</p>
            <div className="cc-row" style={{ marginTop: "var(--cc-space-2)" }}>
              {user.memberships.length === 0 ? (
                <p className="cc-body-sm cc-muted">尚未加入任何部門。</p>
              ) : (
                user.memberships.map((entry) => (
                  <Badge key={`${entry.departmentId}:${entry.kind}`} tone="neutral">
                    {entry.departmentName}・{membershipKindLabels[entry.kind]}
                  </Badge>
                ))
              )}
            </div>
          </div>

          <p className="cc-caption cc-muted">
            角色與部門決定你可以審核與編輯哪些生產單，因此僅能由系統管理員或總經理變更，
            且每次變更都會記錄於稽核紀錄。
          </p>
        </div>
      </Card>

      {/* Only ADMIN and 總經理 change their own password (the user, 2026-10-04). */}
      <Card header={<h2 className="cc-h3">密碼</h2>}>
        {changesOwnPassword(user) ? (
          <>
            <p className="cc-body-sm cc-secondary" style={{ marginBottom: "var(--cc-space-3)" }}>
              變更密碼會結束你在其他裝置上的所有工作階段，包含手機。
            </p>
            <Link className="cc-btn cc-btn--secondary" href="/change-password">
              變更密碼
            </Link>
          </>
        ) : (
          <p className="cc-body-sm cc-secondary">
            密碼由系統管理員或總經理設定。如需變更，請聯絡他們。
          </p>
        )}
      </Card>

      {manages ? (
        <Card header={<h2 className="cc-h3">系統管理</h2>}>
          <p className="cc-body-sm cc-secondary" style={{ marginBottom: "var(--cc-space-3)" }}>
            你可以新增、修改或停用其他使用者的帳號
            {user.roles.includes("ADMIN")
              ? "，並管理表單範本的發布與啟用"
              : ""}
            。
          </p>
          <Link className="cc-btn cc-btn--secondary" href="/admin/users">
            前往系統管理
          </Link>
        </Card>
      ) : null}
    </main>
  );
}
