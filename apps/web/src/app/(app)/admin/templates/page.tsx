import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert, Badge, Card, ScrollRegion } from "@workflow/ui";
import { getSessionUser } from "@/lib/session";
import { isPublished, listAdminTemplates } from "@/lib/templates";

export const metadata: Metadata = { title: "表單範本 · Workflow Portfolio" };

export default async function AdminTemplatesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  // Account management is ADMIN + 總經理; templates are ADMIN only (§5).
  if (!user.roles.includes("ADMIN")) redirect("/admin/users");

  const templates = await listAdminTemplates();

  return (
    <div className="cc-stack">
      <div className="cc-page__header">
        <div>
          <h1 className="cc-h1">表單範本</h1>
          <p className="cc-body-sm cc-muted">
            共 {templates.length} 個範本・
            {templates.filter((template) => template.active).length} 個已啟用
          </p>
        </div>
      </div>

      <Alert tone="info" title="範本定義來自轉錄，不在此處編輯">
        欄位、順序與驗證規則只能來自使用者提供的參考影像，並經過轉錄與確認（AGENTS.md
        §4）。此處負責的是版本的發布與啟用：把已確認的定義正式生效，或停用不再使用的範本。
      </Alert>

      {templates.length === 0 ? (
        <Card>
          <div className="cc-empty">
            <p className="cc-empty__title">尚無表單範本</p>
            <p className="cc-empty__text">
              範本會隨資料庫種子建立。若這裡是空的，表示種子尚未執行。
            </p>
          </div>
        </Card>
      ) : (
        <ScrollRegion label="表單範本清單" className="cc-only-wide">
          <table className="cc-table">
            <caption className="cc-sr-only">表單範本清單</caption>
            <thead>
              <tr>
                <th scope="col">範本</th>
                <th scope="col">部門</th>
                <th scope="col">狀態</th>
                <th scope="col">目前版本</th>
                <th scope="col">版本數</th>
                <th scope="col">
                  <span className="cc-sr-only">操作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => {
                const drafts = template.versions.filter(
                  (version) => !isPublished(version),
                ).length;
                return (
                  <tr key={template.id}>
                    <td>
                      {template.displayName}
                      <span className="cc-caption cc-muted"> ・{template.slug}</span>
                    </td>
                    <td>{template.department.displayName}</td>
                    <td>
                      {template.active ? (
                        <Badge tone="success">已啟用</Badge>
                      ) : (
                        <Badge tone="neutral" dot>
                          未啟用
                        </Badge>
                      )}
                    </td>
                    <td className="cc-tnum">
                      {template.currentVersionNumber ?? "—"}
                    </td>
                    <td className="cc-tnum">
                      {template.versions.length}
                      {drafts > 0 ? (
                        <span className="cc-caption cc-muted">（{drafts} 個草稿）</span>
                      ) : null}
                    </td>
                    <td>
                      <Link
                        className="cc-btn cc-btn--tertiary"
                        href={`/admin/templates/${template.id}`}
                      >
                        管理
                        <span className="cc-sr-only">：{template.displayName}</span>
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollRegion>
      )}

      <div className="cc-only-narrow cc-stack" style={{ gap: "var(--cc-space-3)" }}>
        {templates.map((template) => (
          <Link
            key={template.id}
            href={`/admin/templates/${template.id}`}
            className="cc-sheet-card"
            style={{ textDecoration: "none", display: "block" }}
          >
            <div className="cc-sheet-card__top">
              <span className="cc-sheet-card__no">{template.slug}</span>
              {template.active ? (
                <Badge tone="success">已啟用</Badge>
              ) : (
                <Badge tone="neutral" dot>
                  未啟用
                </Badge>
              )}
            </div>
            <h2 className="cc-sheet-card__title">{template.displayName}</h2>
            <dl className="cc-sheet-card__meta">
              <dt>部門</dt>
              <dd>{template.department.displayName}</dd>
              <dt>目前版本</dt>
              <dd className="cc-tnum">{template.currentVersionNumber ?? "—"}</dd>
            </dl>
          </Link>
        ))}
      </div>
    </div>
  );
}
