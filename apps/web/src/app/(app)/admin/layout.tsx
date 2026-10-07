import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";

/**
 * Administration is open to ADMIN and 總經理. The API enforces the same rule;
 * this guard only avoids rendering a page that would fail every request.
 *
 * Template administration is narrower still: ADMIN only (§5). That page checks
 * the role itself, so this layout admits both and the sub-navigation shows only
 * what the signed-in user can actually open.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const manages =
    user.roles.includes("ADMIN") || user.roles.includes("GENERAL_MANAGER");
  if (!manages) redirect("/");

  return (
    <div className="cc-page" style={{ margin: "0 auto" }}>
      <nav className="cc-breadcrumb" style={{ marginBottom: "var(--cc-space-4)" }}>
        <Link href="/">首頁</Link>
        <span aria-hidden="true">/</span>
        <span>系統管理</span>
      </nav>

      <nav
        className="cc-row"
        aria-label="系統管理"
        style={{ marginBottom: "var(--cc-space-5)" }}
      >
        <Link className="cc-btn cc-btn--secondary" href="/admin/users">
          帳號管理
        </Link>
        {user.roles.includes("ADMIN") ? (
          <>
            <Link className="cc-btn cc-btn--secondary" href="/admin/templates">
              表單範本
            </Link>
            <Link className="cc-btn cc-btn--secondary" href="/admin/notifications">
              通知健康
            </Link>
            <Link className="cc-btn cc-btn--secondary" href="/admin/audit">
              稽核紀錄
            </Link>
          </>
        ) : null}
      </nav>

      {children}
    </div>
  );
}
