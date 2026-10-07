"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { Button, DateRange, Field, type DateRangeValue } from "@workflow/ui";
import { taipeiDaysBefore, taipeiToday } from "@/lib/taipei";

/**
 * Audit search, submitted as a normal form into the URL.
 *
 * Keeping the query in the URL means a result set can be sent to somebody else
 * — which is most of what an investigation is — and the back button behaves.
 *
 * The dates stay in the URL as plain days (`from=2026-08-11`) rather than as
 * the instants the API wants. A pasted link should be readable by the person
 * receiving it, and the day-to-instant expansion is one rule applied in one
 * place rather than something baked into every link.
 */
export function AuditFilters({
  q,
  action,
  targetType,
  from,
  to,
}: {
  q: string | undefined;
  action: string | undefined;
  targetType: string | undefined;
  from: string | undefined;
  to: string | undefined;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(q ?? "");
  const [actionFilter, setActionFilter] = useState(action ?? "");
  const [target, setTarget] = useState(targetType ?? "");
  const [range, setRange] = useState<DateRangeValue>({
    from: from ?? "",
    to: to ?? "",
  });

  // Resolved once per render rather than per click: a preset that computed
  // "today" on press would disagree with the one rendered as pressed if the
  // page were left open across midnight.
  const presets = useMemo(() => {
    const today = taipeiToday();
    return [
      { label: "今天", from: today, to: today },
      { label: "近 7 天", from: taipeiDaysBefore(today, 7), to: today },
      { label: "近 30 天", from: taipeiDaysBefore(today, 30), to: today },
    ];
  }, []);

  // The API rejects an inverted range; saying so here saves the round trip and
  // explains it beside the control rather than at the top of the results.
  const inverted = range.from !== "" && range.to !== "" && range.from > range.to;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inverted) return;
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (actionFilter.trim()) params.set("action", actionFilter.trim());
    if (target.trim()) params.set("targetType", target.trim());
    if (range.from) params.set("from", range.from);
    if (range.to) params.set("to", range.to);
    const suffix = params.toString();
    router.push(suffix === "" ? "/admin/audit" : `/admin/audit?${suffix}`);
  }

  const dirty = Boolean(q || action || targetType || from || to);

  return (
    <form className="cc-stack" onSubmit={submit} noValidate>
      <div className="cc-form-grid">
        <Field
          label="關鍵字"
          name="q"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          help="比對操作名稱、對象類型、對象編號與執行者帳號。"
        />
        <Field
          label="操作"
          name="action"
          value={actionFilter}
          onChange={(event) => setActionFilter(event.target.value)}
          help="完全比對，例如 SHEET_SUBMITTED。"
        />
        <Field
          label="對象類型"
          name="targetType"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          help="完全比對，例如 PRODUCTION_SHEET 或 USER。"
        />
      </div>

      <DateRange
        legend="時間範圍"
        value={range}
        onChange={setRange}
        presets={presets}
        fromName="from"
        toName="to"
        help="以 Asia/Taipei 的日期計算，起訖兩天都包含在內。留空表示不限。"
        error={inverted ? "開始日期不可晚於結束日期。" : undefined}
      />

      <div className="cc-row">
        <Button type="submit" variant="primary">
          搜尋
        </Button>
        {dirty ? (
          <Button
            variant="secondary"
            onClick={() => {
              setQuery("");
              setActionFilter("");
              setTarget("");
              setRange({ from: "", to: "" });
              router.push("/admin/audit");
            }}
          >
            清除條件
          </Button>
        ) : null}
      </div>
    </form>
  );
}
