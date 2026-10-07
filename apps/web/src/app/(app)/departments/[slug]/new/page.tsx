import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDepartmentBySlug } from "@/lib/departments";
import { getSessionUser } from "@/lib/session";
import { getDepartmentSubpages, getSubpageCreationOptions } from "@/lib/subpages";
import { NewSheet, type CreatableSubpage } from "./new-sheet";

export const metadata: Metadata = { title: "建立生產單 · Workflow Portfolio" };

const single = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

/**
 * Creating a sheet has its own page (the user, 2026-09-30), reached from the
 * 建立生產單 button beside 表單權限設定 on the department and subpage pages.
 * `?subpage=` says which subpage it was opened from, and `?form=` which form
 * is chosen, so a reload or a shared link opens the same preview.
 */
export default async function NewSheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ subpage?: string | string[]; form?: string | string[]; from?: string | string[] }>;
}) {
  const [{ slug }, query, user] = await Promise.all([params, searchParams, getSessionUser()]);
  if (!user) redirect("/login");
  const department = await getDepartmentBySlug(slug);
  if (!department) notFound();
  const data = await getDepartmentSubpages(department.id);
  const allowed = data.subpages.filter((subpage) => subpage.capabilities.canCreate);
  const requested = single(query.subpage);
  // Opened from a subpage's own page, that subpage is implied; opened from
  // the department page, the user picks among every one they may create in.
  const fromSubpage = single(query.from) === "subpage" ? allowed.find((subpage) => subpage.id === requested) : undefined;
  const offered = fromSubpage ? [fromSubpage] : allowed;
  const subpages: CreatableSubpage[] = await Promise.all(
    offered.map(async (subpage) => ({
      id: subpage.id,
      name: subpage.name,
      templates: await getSubpageCreationOptions(department.id, subpage.id),
    })),
  );
  const departmentHref = `/departments/${department.slug}`;
  const back = fromSubpage
    ? { href: `${departmentHref}/subpages/${fromSubpage.id}`, label: fromSubpage.name }
    : { href: departmentHref, label: department.displayName };

  return (
    <main className="cc-page cc-stack" style={{ margin: "0 auto" }}>
      <nav className="cc-breadcrumb">
        <Link href="/">首頁</Link>
        <span aria-hidden="true">/</span>
        <Link href={departmentHref}>{department.displayName}</Link>
        {fromSubpage ? (
          <>
            <span aria-hidden="true">/</span>
            <Link href={back.href}>{fromSubpage.name}</Link>
          </>
        ) : null}
        <span aria-hidden="true">/</span>
        <span>建立生產單</span>
      </nav>
      <div className="cc-page__header">
        <div>
          <h1 className="cc-h1">建立生產單</h1>
          <p className="cc-body-sm cc-muted">
            {fromSubpage ? `${department.displayName}・${fromSubpage.name}` : department.displayName}・選擇表單後，下方會顯示空白表單。
          </p>
        </div>
        <Link className="cc-btn cc-btn--secondary" href={back.href}>返回{back.label}</Link>
      </div>
      {subpages.length === 0 ? (
        <div className="cc-card"><div className="cc-card__body"><div className="cc-empty"><p className="cc-empty__title">沒有可建立生產單的子分頁</p><p className="cc-empty__text">你在此部門沒有任何子分頁的建立權限。請洽部門主管。</p></div></div></div>
      ) : (
        <NewSheet
          departmentId={department.id}
          subpages={subpages}
          initialSubpageId={requested}
          initialTemplateId={single(query.form)}
          chooseSubpage={!fromSubpage}
        />
      )}
    </main>
  );
}
