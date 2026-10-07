import { Badge } from "@workflow/ui";
import { describeFieldKey, type SheetFieldHistoryEntry, type TemplateDefinition } from "@/lib/sheet-model";

function taipei(value: string): string {
  return new Intl.DateTimeFormat("zh-Hant-TW", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Taipei",
  }).format(new Date(value));
}

/**
 * Who changed which fields, and when.
 *
 * The API returns field keys and versions, never values — anyone who may read
 * the sheet may read this, and the values themselves are already on the form
 * above with their own permission rules. Keys are shown in printed terms, the
 * same mapping the conflict and submission messages use.
 */
export function FieldHistory({
  entries,
  total,
  definition,
}: {
  entries: SheetFieldHistoryEntry[];
  total: number;
  definition: TemplateDefinition;
}) {
  if (entries.length === 0) {
    return <p className="cc-body-sm cc-muted">尚無欄位修改紀錄。</p>;
  }

  // One save can change many fields; the API returns a row per field. Grouping
  // by the audit event puts one save back together as one line of history.
  const saves = new Map<
    string,
    { at: string; who: string; fields: string[]; invalidated: boolean; version: number }
  >();
  for (const entry of entries) {
    const existing = saves.get(entry.auditEventId);
    const label = describeFieldKey(definition, entry.fieldKey);
    if (existing) {
      existing.fields.push(label);
      continue;
    }
    saves.set(entry.auditEventId, {
      at: entry.createdAt,
      who: entry.actor?.displayName ?? "已停用的帳號",
      fields: [label],
      invalidated: entry.approvalInvalidated,
      version: entry.newVersion,
    });
  }

  return (
    <div className="cc-stack">
      <ol className="cc-timeline">
        {[...saves.entries()].map(([auditEventId, save]) => (
          <li className="cc-timeline__item" key={auditEventId}>
            <span
              className={`cc-timeline__marker${
                save.invalidated ? " cc-timeline__marker--danger" : ""
              }`}
              aria-hidden="true"
            >
              {save.invalidated ? "!" : "✎"}
            </span>
            <p className="cc-timeline__title">
              {save.who} 修改了 {save.fields.length} 個欄位
              {save.invalidated ? <Badge tone="danger">核准失效</Badge> : null}
            </p>
            <p className="cc-timeline__meta">
              {taipei(save.at)}・版本 {save.version}
            </p>
            <p className="cc-timeline__note">{save.fields.join("、")}</p>
          </li>
        ))}
      </ol>
      {total > entries.length ? (
        <p className="cc-caption cc-muted">
          顯示最近 {entries.length} 次修改，共 {total} 筆紀錄。完整紀錄可由系統管理員在稽核紀錄中查詢。
        </p>
      ) : null}
      <p className="cc-caption cc-muted">
        此處只記錄「哪些欄位被誰在何時修改」，不包含填寫的內容。
      </p>
    </div>
  );
}
