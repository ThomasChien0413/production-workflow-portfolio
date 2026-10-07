import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { isCompanyReader, requiredApprovalRole } from "@workflow/domain";
import { Badge, Card, ScrollRegion } from "@workflow/ui";
import { listDepartments } from "@/lib/departments";
import { getSessionUser } from "@/lib/session";
import {
  SHEET_STATE_LABEL,
  SHEET_STATE_TONE,
  listSheets,
} from "@/lib/sheets";

export const metadata: Metadata = { title: "審核 · Workflow Portfolio" };

function taipei(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-Hant-TW", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Taipei",
  }).format(new Date(value));
}

/**
 * 審核: the sheets waiting for review (the user, 2026-10-01).
 *
 * Only 分條申請單 is reviewed, by 業務, 協理 and 總經理 in turn after its
 * department sends it out. Each reviewer sees the sheets at their own stage;
 * ADMIN, who reviews nothing, sees every stage. Anyone who is not a company
 * reader has no 審核 and is sent home. Longest waiting first: a stage's
 * `updatedAt` is when the sheet arrived at it.
 */
export default async function ReviewPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isCompanyReader(user)) redirect("/");

  const [sheets, departments] = await Promise.all([listSheets(), listDepartments()]);
  const seesEveryStage = user.roles.includes("ADMIN");
  const waiting = sheets
    .filter((sheet) => {
      const role = requiredApprovalRole(sheet.state);
      return role !== null && (seesEveryStage || user.roles.includes(role));
    })
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  const departmentName = (id: string) =>
    departments.find((department) => department.id === id)?.displayName ?? "—";
  const caption = seesEveryStage ? "審核中的生產單" : "待你審核的生產單";

  return (
    <main className="cc-page cc-stack" style={{ margin: "0 auto" }}>
      <nav className="cc-breadcrumb">
        <Link href="/">首頁</Link>
        <span aria-hidden="true">/</span>
        <span>審核</span>
      </nav>

      <div className="cc-page__header">
        <div>
          <h1 className="cc-h1">審核</h1>
          <p className="cc-body-sm cc-muted">
            {seesEveryStage
              ? `審核中 ${waiting.length} 張・業務、協理、總經理依序核准`
              : `待你審核 ${waiting.length} 張`}
          </p>
        </div>
      </div>

      {waiting.length === 0 ? (
        <Card>
          <div className="cc-empty">
            <p className="cc-empty__title">目前沒有待審核的生產單</p>
            <p className="cc-empty__text">
              部門送出審核的分條申請單，輪到你審核時會出現在這裡。
            </p>
          </div>
        </Card>
      ) : (
        <>
          <ScrollRegion label={caption} className="cc-only-wide">
            <table className="cc-table">
              <caption className="cc-sr-only">
                {caption}，共 {waiting.length} 張，等候最久的在前
              </caption>
              <thead>
                <tr>
                  <th scope="col">表單</th>
                  <th scope="col">送審部門</th>
                  <th scope="col">審核階段</th>
                  <th scope="col">送達時間</th>
                  <th scope="col">
                    <span className="cc-sr-only">操作</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {waiting.map((sheet) => (
                  <tr key={sheet.id}>
                    <td>{sheet.templateName}</td>
                    <td>{departmentName(sheet.currentDepartmentId)}</td>
                    <td>
                      <Badge tone={SHEET_STATE_TONE[sheet.state]}>
                        {SHEET_STATE_LABEL[sheet.state]}
                      </Badge>
                    </td>
                    <td className="cc-tnum cc-muted">{taipei(sheet.updatedAt)}</td>
                    <td>
                      <Link className="cc-btn cc-btn--tertiary" href={`/sheets/${sheet.id}?from=review`}>
                        審核
                        <span className="cc-sr-only">：{sheet.templateName}</span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>

          <p className="cc-sr-only cc-only-narrow">
            {caption}，共 {waiting.length} 張，等候最久的在前
          </p>
          <div className="cc-only-narrow cc-stack" style={{ gap: "var(--cc-space-3)" }}>
            {waiting.map((sheet) => (
              <Link
                key={sheet.id}
                href={`/sheets/${sheet.id}?from=review`}
                className="cc-sheet-card"
                style={{ textDecoration: "none", display: "block" }}
              >
                <div className="cc-sheet-card__top">
                  <span className="cc-sheet-card__name">{sheet.templateName}</span>
                  <Badge tone={SHEET_STATE_TONE[sheet.state]}>
                    {SHEET_STATE_LABEL[sheet.state]}
                  </Badge>
                </div>
                <dl className="cc-sheet-card__meta">
                  <dt>送審部門</dt>
                  <dd>{departmentName(sheet.currentDepartmentId)}</dd>
                  <dt>送達</dt>
                  <dd className="cc-tnum">{taipei(sheet.updatedAt)}</dd>
                </dl>
              </Link>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
