import { Badge, ScrollRegion } from "@workflow/ui";
import type { TemplateDefinition, TemplateFieldDefinition } from "@/lib/sheet-model";

/**
 * A template definition, rendered for reading rather than editing.
 *
 * v1 has no form builder (PLAN.md §3): definitions come from a transcription of
 * a supplied image and are versioned as data. What an administrator needs here
 * is to see exactly what they are about to publish — every field rule, in the
 * same words the sheet screen will enforce.
 */
export function DefinitionView({ definition }: { definition: TemplateDefinition }) {
  return (
    <div className="cc-stack">
      <dl className="cc-deflist">
        <dt>定義狀態</dt>
        <dd>
          {definition.status === "APPROVED" ? (
            <Badge tone="success">APPROVED</Badge>
          ) : (
            <Badge tone="warning">DRAFT_PENDING_CONFIRMATION</Badge>
          )}
        </dd>
        <dt>表單名稱</dt>
        <dd>{definition.displayName}</dd>
        <dt>文件編號</dt>
        <dd className="cc-tnum">
          {definition.documentLabel}
          {definition.documentCode}
        </dd>
        <dt>所屬部門</dt>
        <dd>{definition.ownerDepartmentCode}</dd>
        <dt>可建立部門</dt>
        <dd>{definition.allowedCreatorDepartmentCodes.join("、")}</dd>
        {/* Who may open, edit and submit a sheet is decided per department
            subpage, and replaces the identity rules templates once carried
            (user decision, 2026-09-24). Those fields stay in published
            definitions, which are immutable, but showing them here would
            describe rules nothing enforces. */}
        <dt>建立與修改</dt>
        <dd>由各部門主管在子分頁設定中指定（查看、建立、修改、送審）</dd>
        <dt>審核</dt>
        <dd>
          {definition.workflow.requiresReview
            ? `需要 ${definition.workflow.approvalRoles.join(" → ")}`
            : "不需審核"}
        </dd>
        <dt>列印版面</dt>
        <dd>
          {definition.printLayout
            ? `${definition.printLayout.paperSize}・${definition.printLayout.orientation === "LANDSCAPE" ? "橫向" : "直向"}・邊界 ${definition.printLayout.marginMm} mm`
            : "舊版定義：使用固定相容版面"}
        </dd>
      </dl>

      {definition.openQuestions.length > 0 ? (
        <div>
          <p className="cc-overline">待確認問題（{definition.openQuestions.length}）</p>
          <ol className="cc-stack" style={{ margin: "var(--cc-space-2) 0 0", paddingInlineStart: 20 }}>
            {definition.openQuestions.map((question) => (
              <li key={question} className="cc-body-sm">
                {question}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {definition.sections.map((section) => (
        <section key={section.key}>
          <p className="cc-overline">
            {section.type}
            {"label" in section && section.label ? `・${section.label}` : ""}
          </p>
          {section.type === "APPROVAL_STATUS" ? (
            <ul className="cc-stack" style={{ margin: "var(--cc-space-2) 0 0", paddingInlineStart: 20 }}>
              {section.blocks.map((block) => (
                <li key={block.mappedTo} className="cc-body-sm">
                  {block.visibleLabel} → {block.mappedTo}
                  {block.transcriptionStatus === "AMBIGUOUS" ? (
                    <Badge tone="warning">轉錄待確認</Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : section.type === "DIAGRAMS" ? (
            // Printed illustrations carry no field rules, so the list of what
            // gets drawn is the only thing there is to check here.
            <ul className="cc-stack" style={{ margin: "var(--cc-space-2) 0 0", paddingInlineStart: 20 }}>
              {section.items.map((item) => (
                <li key={item.key} className="cc-body-sm">
                  {item.label}
                  <span className="cc-caption cc-muted"> ・{item.asset}</span>
                </li>
              ))}
            </ul>
          ) : (
            <FieldTable fields={sectionFields(section)} />
          )}
        </section>
      ))}
    </div>
  );
}

function sectionFields(
  section: TemplateDefinition["sections"][number],
): TemplateFieldDefinition[] {
  switch (section.type) {
    case "FIELDS":
      return section.fields;
    case "FIXED_ROWS":
      return section.columns;
    case "MATRIX":
      return section.groups.flatMap((group) => group.rows);
    case "NUMBERED_GRID":
      return [section.cell];
    case "NUMBERED_BLANKS":
      return [section.entry];
    case "APPROVAL_STATUS":
    case "DIAGRAMS":
    case "REFERENCE_BAND":
      return [];
  }
}

function FieldTable({ fields }: { fields: TemplateFieldDefinition[] }) {
  if (fields.length === 0) return null;
  return (
    <ScrollRegion label="欄位規則">
      <table className="cc-table">
        <caption className="cc-sr-only">欄位規則</caption>
        <thead>
          <tr>
            <th scope="col">欄位</th>
            <th scope="col">型別</th>
            <th scope="col">必填</th>
            <th scope="col">受審</th>
            <th scope="col">可編輯狀態</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <tr key={field.key}>
              <td>
                {field.label}
                <span className="cc-caption cc-muted"> ・{field.key}</span>
                {field.validationStatus === "PENDING_CONFIRMATION" ? (
                  <Badge tone="warning">待確認</Badge>
                ) : null}
              </td>
              <td>{field.type}</td>
              <td>{field.required === null ? "未定" : field.required ? "是" : "否"}</td>
              <td>{field.reviewed ? "是" : "否"}</td>
              <td className="cc-caption">{field.editableStates.join("、")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}
