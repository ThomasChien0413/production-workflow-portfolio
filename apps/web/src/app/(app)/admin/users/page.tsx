import type { Metadata } from "next";
import Link from "next/link";
import { Badge, ScrollRegion } from "@workflow/ui";
import { membershipKindLabels } from "@workflow/contracts";
import {
  listAdminDepartments,
  listAdminRoles,
  listAdminUsers,
  roleLabel,
  type AdminRole,
  type AdminUser,
} from "@/lib/admin";
import { UserFilters } from "./user-filters";
import { customLoginName } from "@/lib/login-name";

export const metadata: Metadata = { title: "帳號管理 · Workflow Portfolio" };

function Assignments({ user, roles }: { user: AdminUser; roles: AdminRole[] }) {
  if (user.roles.length === 0 && user.memberships.length === 0) {
    return <span className="cc-muted">未指派</span>;
  }
  return (
    <span className="cc-row" style={{ gap: "var(--cc-space-1)" }}>
      {user.roles.map((role) => (
        <Badge key={role} tone="info">
          {roleLabel(role, roles)}
        </Badge>
      ))}
      {user.memberships.map((membership) => (
        <Badge key={`${membership.departmentId}:${membership.kind}`} tone="neutral">
          {membership.departmentName}・{membershipKindLabels[membership.kind]}
        </Badge>
      ))}
    </span>
  );
}

function StatusBadge({ user }: { user: AdminUser }) {
  if (!user.active) {
    return (
      <Badge tone="neutral" dot>
        已停用
      </Badge>
    );
  }
  if (user.passwordWarning) {
    return <Badge tone="warning">預設密碼</Badge>;
  }
  return <Badge tone="success">啟用中</Badge>;
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const q = typeof params["q"] === "string" ? params["q"] : undefined;
  const active = typeof params["active"] === "string" ? params["active"] : undefined;

  const [users, roles, departments] = await Promise.all([
    listAdminUsers({ q, active }),
    listAdminRoles(),
    listAdminDepartments(),
  ]);

  return (
    <div className="cc-stack">
      <div className="cc-page__header">
        <div>
          <h1 className="cc-h1">帳號管理</h1>
          <p className="cc-body-sm cc-muted">
            共 {users.length} 個帳號・{departments.length} 個部門
          </p>
        </div>
        <Link className="cc-btn cc-btn--primary" href="/admin/users/new">
          新增帳號
        </Link>
      </div>

      <UserFilters />

      {users.length === 0 ? (
        <div className="cc-card">
          <div className="cc-empty">
            <p className="cc-empty__title">沒有符合的帳號</p>
            <p className="cc-empty__text">
              目前的搜尋或篩選條件沒有任何帳號符合。試著清除條件後再查看。
            </p>
            <Link className="cc-btn cc-btn--secondary" href="/admin/users">
              清除條件
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* Desktop and tablet: sortable-shaped table. DESIGN.md §3.3. */}
          <ScrollRegion label="系統帳號清單" className="cc-only-wide">
            <table className="cc-table">
              <caption className="cc-sr-only">系統帳號清單</caption>
              <thead>
                <tr>
                  <th scope="col">姓名</th>
                  <th scope="col">狀態</th>
                  <th scope="col">角色與部門</th>
                  <th scope="col">通知裝置</th>
                  <th scope="col">
                    <span className="cc-sr-only">操作</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.displayName}{customLoginName(user) ? <p className="cc-caption cc-muted" style={{ overflowWrap: "anywhere" }}>登入名稱：{customLoginName(user)}</p> : null}</td>
                    <td>
                      <StatusBadge user={user} />
                    </td>
                    <td>
                      <Assignments user={user} roles={roles} />
                    </td>
                    <td>
                      {user.pushDevices.count > 0 ? (
                        <Badge tone="success">{user.pushDevices.count} 台</Badge>
                      ) : (
                        <Badge tone="neutral" dot>
                          未開啟
                        </Badge>
                      )}
                    </td>
                    <td>
                      <Link
                        className="cc-btn cc-btn--tertiary"
                        href={`/admin/users/${user.id}`}
                      >
                        管理
                        <span className="cc-sr-only">：{user.displayName}</span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>

          {/* Mobile: one card per account, every value keeps a visible label. */}
          <div className="cc-only-narrow cc-stack" style={{ gap: "var(--cc-space-3)" }}>
            {users.map((user) => (
              <Link
                key={user.id}
                href={`/admin/users/${user.id}`}
                className="cc-sheet-card"
                style={{ textDecoration: "none", display: "block" }}
              >
                <div className="cc-sheet-card__top">
                  <StatusBadge user={user} />
                </div>
                <h2 className="cc-sheet-card__title">{user.displayName}</h2>
                <dl className="cc-sheet-card__meta">
                  {customLoginName(user) ? <><dt>登入名稱</dt><dd style={{ overflowWrap: "anywhere" }}>{customLoginName(user)}</dd></> : null}
                  <dt>角色與部門</dt>
                  <dd>
                    <Assignments user={user} roles={roles} />
                  </dd>
                  <dt>通知裝置</dt>
                  <dd>{user.pushDevices.count > 0 ? `${user.pushDevices.count} 台` : "未開啟"}</dd>
                </dl>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
