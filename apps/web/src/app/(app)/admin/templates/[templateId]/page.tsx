import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Alert, Badge, Card } from "@workflow/ui";
import { getSessionUser } from "@/lib/session";
import { getAdminTemplate, isPublished, publicationBlockers } from "@/lib/templates";
import { DefinitionView } from "./definition-view";
import { ActivationControl, PublishControl } from "./template-actions";

export const metadata: Metadata = { title: "表單範本 · Workflow Portfolio" };

function taipei(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-Hant-TW", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Taipei",
  }).format(new Date(value));
}

export default async function AdminTemplateDetailPage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  const { templateId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!user.roles.includes("ADMIN")) redirect("/admin/users");

  const template = await getAdminTemplate(templateId);
  if (!template) notFound();

  // Newest first: the version being decided about is the one at the top.
  const versions = [...template.versions].sort((a, b) => b.version - a.version);

  return (
    <div className="cc-stack">
      <div className="cc-page__header">
        <div>
          <div className="cc-row" style={{ gap: "var(--cc-space-3)" }}>
            <h1 className="cc-h1">{template.displayName}</h1>
            {template.active ? (
              <Badge tone="success">已啟用</Badge>
            ) : (
              <Badge tone="neutral" dot>
                未啟用
              </Badge>
            )}
          </div>
          <p className="cc-body-sm cc-muted">
            {template.department.displayName}・{template.slug}・目前版本{" "}
            {template.currentVersionNumber ?? "—"}
          </p>
        </div>
        <Link className="cc-btn cc-btn--secondary" href="/admin/templates">
          返回清單
        </Link>
      </div>

      {template.description ? (
        <p className="cc-body-sm cc-secondary">{template.description}</p>
      ) : null}

      <Card header={<h2 className="cc-h3">啟用狀態</h2>}>
        <ActivationControl template={template} />
      </Card>

      {versions.length === 0 ? (
        <Card>
          <div className="cc-empty">
            <p className="cc-empty__title">尚無版本</p>
            <p className="cc-empty__text">
              版本由轉錄流程建立並寫入資料庫。此畫面負責發布與啟用，不建立定義。
            </p>
          </div>
        </Card>
      ) : (
        versions.map((version) => {
          const published = isPublished(version);
          const blockers = publicationBlockers(version);
          return (
            <Card
              key={version.id}
              header={
                <div className="cc-row" style={{ gap: "var(--cc-space-3)" }}>
                  <h2 className="cc-h3">第 {version.version} 版</h2>
                  {published ? (
                    <Badge tone="success">已發布</Badge>
                  ) : (
                    <Badge tone="warning">草稿</Badge>
                  )}
                  {template.currentVersionNumber === version.version ? (
                    <Badge tone="info">目前版本</Badge>
                  ) : null}
                </div>
              }
            >
              <div className="cc-stack">
                <dl className="cc-deflist">
                  <dt>建立時間</dt>
                  <dd className="cc-tnum">{taipei(version.createdAt)}</dd>
                  <dt>發布時間</dt>
                  <dd className="cc-tnum">{taipei(version.publishedAt)}</dd>
                  <dt>需要審核</dt>
                  <dd>{version.requiresReview ? "是" : "否"}</dd>
                  <dt>來源指紋</dt>
                  <dd className="cc-tnum" style={{ wordBreak: "break-all" }}>
                    {version.sourceReference ?? "—"}
                  </dd>
                  <dt>變更說明</dt>
                  <dd>{version.changeNotes ?? "—"}</dd>
                </dl>

                {!version.definitionValid ? (
                  <Alert tone="danger" title="定義無法解析" assertive>
                    這個版本儲存的定義不符合目前的結構描述，因此無法顯示，也無法發布。
                  </Alert>
                ) : version.definition ? (
                  <DefinitionView definition={version.definition} />
                ) : null}

                {published ? (
                  <>
                    <p className="cc-help">
                      已發布的版本不可修改。若需要修正，必須建立新的版本；已建立的生產單仍會維持它們原本的版本。
                    </p>
                    {template.currentVersionNumber !== version.version ? (
                      <p className="cc-help">
                        此版本已發布，但不是這個範本的目前版本，因此不會用於新建立的生產單。
                      </p>
                    ) : null}
                  </>
                ) : (
                  <PublishControl
                    template={template}
                    version={version}
                    blockers={blockers}
                  />
                )}
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}
