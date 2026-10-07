import Link from "next/link";
import { Card } from "@workflow/ui";
import { SHEET_STATE_LABEL, type SheetSummary } from "@/lib/sheet-model";

/**
 * Sheets handed in from another department that wait for their 主管 to
 * place them in a subpage, set an assignee and a due date. Shown to those who
 * may place them, on every page of the department.
 */
export function PendingSheets({ sheets }: { sheets: SheetSummary[] }) {
  return (
    <Card header={<h2 className="cc-h3">待分派・{sheets.length}</h2>}>
      <p className="cc-body-sm cc-muted">跨部門轉送後尚未選擇子分頁、負責員工與期限的生產單會顯示在這裡。</p>
      {sheets.length > 0 ? (
        <ul className="cc-stack" style={{ marginTop: "var(--cc-space-3)", paddingInlineStart: "20px" }}>
          {sheets.map((sheet) => (
            <li key={sheet.id}>
              <Link href={`/sheets/${sheet.id}`}>
                {sheet.templateName}・{SHEET_STATE_LABEL[sheet.state]}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="cc-caption cc-muted" style={{ marginTop: "var(--cc-space-2)" }}>
          目前沒有待分派生產單。
        </p>
      )}
    </Card>
  );
}
