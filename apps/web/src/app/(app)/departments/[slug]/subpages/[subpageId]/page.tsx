import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Alert, Badge, Card, ScrollRegion } from "@workflow/ui";
import { getDepartmentBySlug } from "@/lib/departments";
import { getSessionUser } from "@/lib/session";
import { getDepartmentSubpages } from "@/lib/subpages";
import { SHEET_STATE_LABEL, SHEET_STATE_TONE, listSheets } from "@/lib/sheets";
import { SubpageTabs } from "../../subpage-tabs";
import { PendingSheets } from "../../pending-sheets";

export const metadata: Metadata = { title: "工作子分頁 · Workflow Portfolio" };

function taipei(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-Hant-TW", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Taipei" }).format(new Date(value));
}

export default async function SubpagePage({ params }: { params: Promise<{ slug: string; subpageId: string }> }) {
  const [{ slug, subpageId }, user] = await Promise.all([params, getSessionUser()]);
  if (!user) redirect("/login");
  const department = await getDepartmentBySlug(slug);
  if (!department) notFound();
  const data = await getDepartmentSubpages(department.id);
  const subpage = data.subpages.find((item) => item.id === subpageId);
  if (!subpage || !subpage.capabilities.canView) notFound();
  // The department page opens a subpage now, so the 主管 sees what waits to
  // be placed here, on every subpage (the user, 2026-10-03).
  const [sheets, pendingSheets] = await Promise.all([
    listSheets({ departmentId: department.id, subpageId }),
    data.canManage
      ? listSheets({ departmentId: department.id }).then((all) => all.filter((sheet) => sheet.subpageId === null))
      : Promise.resolve([]),
  ]);

  return <main className="cc-page cc-stack" style={{ margin: "0 auto" }}>
    <nav className="cc-breadcrumb"><Link href="/">首頁</Link><span aria-hidden="true">/</span><Link href={`/departments/${department.slug}`}>{department.displayName}</Link><span aria-hidden="true">/</span><span>{subpage.name}</span></nav>
    <div className="cc-page__header"><div><h1 className="cc-h1">{subpage.name}</h1><p className="cc-body-sm cc-muted">{department.displayName}・目前 {sheets.length} 張可檢視的生產單</p></div><div className="cc-row"><Link className="cc-btn cc-btn--secondary" href={`/departments/${department.slug}/history?subpageId=${subpage.id}`}>完工紀錄</Link>{data.canManage ? <Link className="cc-btn cc-btn--secondary" href={`/departments/${department.slug}/settings`}>表單權限設定</Link> : null}{subpage.capabilities.canCreate ? <Link className="cc-btn cc-btn--primary" href={`/departments/${department.slug}/new?from=subpage&subpage=${subpage.id}`}>建立生產單</Link> : null}</div></div>
    <SubpageTabs slug={department.slug} subpages={data.subpages} current={subpage.id} />
    {subpage.capabilities.canCreate ? null : <Alert tone="info" title="此子分頁目前為唯讀">你可以查看生產單，但沒有在此子分頁建立新單的權限。</Alert>}
    {data.canManage ? <PendingSheets sheets={pendingSheets} /> : null}
    <section className="cc-stack" aria-labelledby="subpage-sheets-title"><h2 className="cc-h2" id="subpage-sheets-title">生產單</h2>
      {sheets.length === 0 ? <Card><div className="cc-empty"><p className="cc-empty__title">目前沒有生產單</p><p className="cc-empty__text">此子分頁尚無你可以檢視的生產單。</p></div></Card> : <>
        <ScrollRegion label={`${subpage.name} 生產單清單`} className="cc-only-wide"><table className="cc-table"><thead><tr><th scope="col">表單</th><th scope="col">狀態</th><th scope="col">交期</th><th scope="col">最後更新</th><th scope="col"><span className="cc-sr-only">操作</span></th></tr></thead><tbody>{sheets.map((sheet) => <tr key={sheet.id}><td>{sheet.templateName}</td><td><Badge tone={SHEET_STATE_TONE[sheet.state]}>{SHEET_STATE_LABEL[sheet.state]}</Badge></td><td className="cc-tnum cc-muted">{taipei(sheet.dueAt)}</td><td className="cc-tnum cc-muted">{taipei(sheet.updatedAt)}</td><td><Link className="cc-btn cc-btn--tertiary" href={`/sheets/${sheet.id}`}>開啟<span className="cc-sr-only">：{sheet.templateName}</span></Link></td></tr>)}</tbody></table></ScrollRegion>
        <div className="cc-only-narrow cc-stack">{sheets.map((sheet) => <Link key={sheet.id} href={`/sheets/${sheet.id}`} className="cc-sheet-card" style={{ textDecoration: "none", display: "block" }}><div className="cc-sheet-card__top"><span className="cc-sheet-card__name">{sheet.templateName}</span><Badge tone={SHEET_STATE_TONE[sheet.state]}>{SHEET_STATE_LABEL[sheet.state]}</Badge></div><dl className="cc-sheet-card__meta"><dt>交期</dt><dd className="cc-tnum">{taipei(sheet.dueAt)}</dd><dt>更新</dt><dd className="cc-tnum">{taipei(sheet.updatedAt)}</dd></dl></Link>)}</div>
      </>}
    </section>
  </main>;
}
