import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Card } from "@workflow/ui";
import { membershipKindLabels } from "@workflow/contracts";
import { getDepartmentBySlug } from "@/lib/departments";
import { getSessionUser } from "@/lib/session";
import { getDepartmentSubpages } from "@/lib/subpages";
import { listSheets } from "@/lib/sheets";
import { PendingSheets } from "./pending-sheets";

export const metadata: Metadata = { title: "部門 · Workflow Portfolio" };

/**
 * A department has no page of its own any more (the user, 2026-10-03): its
 * sheets live in its subpages, and there is no 全部 view across them. The
 * department address opens the first subpage the user may view. A department
 * with none asks its 主管 to create one; everyone else is told to wait for it.
 */
export default async function DepartmentPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const department = await getDepartmentBySlug(slug);
  if (!department) notFound();

  const subpageData = await getDepartmentSubpages(department.id);
  const first = subpageData.subpages.find((subpage) => subpage.capabilities.canView);
  if (first) redirect(`/departments/${department.slug}/subpages/${first.id}`);

  const memberships = user.memberships.filter(
    (entry) => entry.departmentId === department.id,
  );
  // A sheet handed in from another department waits for placement even
  // before the department has a subpage to place it in.
  const pendingSheets = subpageData.canManage
    ? (await listSheets({ departmentId: department.id })).filter((sheet) => sheet.subpageId === null)
    : [];
  const settings = `/departments/${department.slug}/settings`;

  return (
    <main className="cc-page cc-stack" style={{ margin: "0 auto" }}>
      <nav className="cc-breadcrumb">
        <Link href="/">首頁</Link>
        <span aria-hidden="true">/</span>
        <span>{department.displayName}</span>
      </nav>

      <div className="cc-page__header">
        <div className="cc-row" style={{ gap: "var(--cc-space-3)" }}>
          <h1 className="cc-h1">{department.displayName}</h1>
          {memberships.length > 0 ? (
            <Badge tone="info">
              我的部門・
              {memberships.map((entry) => membershipKindLabels[entry.kind]).join("、")}
            </Badge>
          ) : null}
        </div>
        {subpageData.canManage ? (
          <div className="cc-row">
            <Link className="cc-btn cc-btn--secondary" href={settings}>
              表單權限設定
            </Link>
          </div>
        ) : null}
      </div>

      {subpageData.canManage ? (
        <Card>
          <div className="cc-empty">
            <p className="cc-empty__title">此部門還沒有子分頁</p>
            <p className="cc-empty__text">
              請先新增子分頁，並勾選可使用的表單、設定身分權限，部門成員才能在其中建立與檢視生產單。
            </p>
            <Link className="cc-btn cc-btn--primary" href={`${settings}#new-subpage`}>
              新增子分頁
            </Link>
          </div>
        </Card>
      ) : (
        <Card>
          <div className="cc-empty">
            <p className="cc-empty__title">沒有可查看的子分頁</p>
            <p className="cc-empty__text">請由部門主管新增子分頁並設定查看權限。</p>
          </div>
        </Card>
      )}

      {subpageData.canManage ? <PendingSheets sheets={pendingSheets} /> : null}
    </main>
  );
}
