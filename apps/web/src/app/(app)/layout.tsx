import { redirect } from "next/navigation";
import { isCompanyReader } from "@workflow/domain";
import { AppShell, type NavEntry } from "@/components/app-shell";
import { unreadNotificationCount } from "@/lib/notifications";
import { getSessionUser } from "@/lib/session";
import { PushSync } from "@/components/push-reminder";

/**
 * The signed-in application.
 *
 * A route group rather than the root layout, because /login must not carry
 * navigation: it has no session to navigate with.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Both reads are issued at once. Awaiting the session first and the count
  // afterwards put two sequential API round trips in front of every signed-in
  // page — the shell is on all of them, so that cost is paid on every
  // navigation. The count does not depend on the session: it is read from the
  // same cookie, and it degrades to 0 rather than throwing, so a signed-out
  // request wastes one call and still redirects.
  const [user, unread] = await Promise.all([
    getSessionUser(),
    unreadNotificationCount(),
  ]);
  if (!user) redirect("/login");

  const manages =
    user.roles.includes("ADMIN") || user.roles.includes("GENERAL_MANAGER");

  const entries: NavEntry[] = [
    { href: "/", label: "首頁" },
    // ADMIN, 總經理, 協理 and 業務 read every department, so they alone have the
    // company-wide list (the user, 2026-10-01). Everyone else works in their
    // department pages.
    ...(isCompanyReader(user) ? [{ href: "/sheets", label: "審核", match: "review-queue" as const }] : []),
    { href: "/notifications", label: "通知", badge: unread },
    { href: "/settings", label: "設定" },
    ...(manages ? [{ href: "/admin/users", label: "系統管理" }] : []),
  ];

  return (
    <AppShell entries={entries} title={user.displayName}>
      <PushSync />
      {children}
    </AppShell>
  );
}
