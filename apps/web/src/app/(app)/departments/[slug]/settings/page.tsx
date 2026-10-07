import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDepartmentBySlug } from "@/lib/departments";
import { getSessionUser } from "@/lib/session";
import { getDepartmentSubpages } from "@/lib/subpages";
import { SubpageSettings } from "./subpage-settings";

export const metadata: Metadata = { title: "表單權限設定 · Workflow Portfolio" };

export default async function DepartmentSettingsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ open?: string | string[] }> }) {
  const [{ slug }, { open }, user] = await Promise.all([params, searchParams, getSessionUser()]);
  if (!user) redirect("/login");
  const department = await getDepartmentBySlug(slug);
  if (!department) notFound();
  const data = await getDepartmentSubpages(department.id);
  if (!data.canManage) redirect(`/departments/${department.slug}`);
  return (
    <main className="cc-page cc-stack" style={{ margin: "0 auto" }}>
      <nav className="cc-breadcrumb">
        <Link href="/">首頁</Link><span aria-hidden="true">/</span>
        <Link href={`/departments/${department.slug}`}>{department.displayName}</Link><span aria-hidden="true">/</span>
        <span>表單權限設定</span>
      </nav>
      <div className="cc-page__header">
        <div>
          <h1 className="cc-h1">{department.displayName}・表單權限設定</h1>
          <p className="cc-body-sm cc-muted">建立工作子分頁，設定訂單人員與員工的權限，並選擇可使用的表單。</p>
        </div>
        <Link className="cc-btn cc-btn--secondary" href={`/departments/${department.slug}`}>返回部門</Link>
      </div>
      <SubpageSettings departmentId={department.id} departmentName={department.displayName} initial={data} initialOpen={typeof open === "string" ? open : undefined} />
    </main>
  );
}
