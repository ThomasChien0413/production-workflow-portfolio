"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { Button, DateRange, Field, type DateRangeValue } from "@workflow/ui";
import { taipeiDaysBefore, taipeiToday } from "@/lib/taipei";
import type { HistorySort } from "@/lib/sheet-history-model";
import { useInteractive } from "@/lib/use-interactive";

type Option = { id: string; displayName: string };

export function HistoryFilters({
  basePath,
  q,
  templateId,
  subpageId,
  from,
  to,
  sort,
  templates,
  subpages,
}: {
  basePath: string;
  q?: string | undefined;
  templateId?: string | undefined;
  subpageId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  sort: HistorySort;
  templates: Option[];
  subpages: Option[];
}) {
  const router = useRouter();
  const interactive = useInteractive();
  const [query, setQuery] = useState(q ?? "");
  const [template, setTemplate] = useState(templateId ?? "");
  const [subpage, setSubpage] = useState(subpageId ?? "");
  const [range, setRange] = useState<DateRangeValue>({
    from: from ?? "",
    to: to ?? "",
  });

  const presets = useMemo(() => {
    const today = taipeiToday();
    return [
      { label: "今天", from: today, to: today },
      { label: "近 7 天", from: taipeiDaysBefore(today, 7), to: today },
      { label: "近 30 天", from: taipeiDaysBefore(today, 30), to: today },
    ];
  }, []);
  const inverted = range.from !== "" && range.to !== "" && range.from > range.to;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inverted) return;
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (template) params.set("templateId", template);
    if (subpage) params.set("subpageId", subpage);
    if (range.from) params.set("from", range.from);
    if (range.to) params.set("to", range.to);
    if (sort.key !== "completedAt") params.set("sort", sort.key);
    if (sort.direction !== "desc" || sort.key !== "completedAt") {
      params.set("direction", sort.direction);
    }
    const suffix = params.toString();
    router.push(suffix === "" ? basePath : `${basePath}?${suffix}`);
  }

  const filtered = Boolean(q || templateId || subpageId || from || to);

  return (
    <form className="cc-stack" onSubmit={submit} noValidate>
      {/*
       * These are controlled fields. Keep the whole filter inert until React
       * owns their state so an early tap cannot be accepted by the server HTML
       * and then discarded when hydration installs the empty client state.
       */}
      <fieldset
        disabled={!interactive}
        style={{ border: 0, margin: 0, minInlineSize: 0, padding: 0, width: "100%" }}
      >
        <div className="cc-stack">
          <div className="cc-form-grid cc-form-grid--dense">
            <Field
              label="關鍵字"
              name="q"
              value={query}
              maxLength={128}
              onChange={(event) => setQuery(event.target.value)}
              help="比對工單編號、表單範本與已儲存的表單內容。結果不顯示符合的內容。"
            />
            <SelectField
              id="history-subpage"
              label="子分頁"
              name="subpageId"
              value={subpage}
              onChange={setSubpage}
              options={subpages}
            />
            <SelectField
              id="history-template"
              label="表單範本"
              name="templateId"
              value={template}
              onChange={setTemplate}
              options={templates}
            />
          </div>

          <DateRange
            legend="完成日期"
            value={range}
            onChange={setRange}
            presets={presets}
            fromName="from"
            toName="to"
            help="以 Asia/Taipei 的完成日期計算，起訖兩天都包含在內。"
            error={inverted ? "開始日期不可晚於結束日期。" : undefined}
          />

          <div className="cc-row">
            <Button type="submit" variant="primary">
              搜尋
            </Button>
            {filtered ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setQuery("");
                  setTemplate("");
                  setSubpage("");
                  setRange({ from: "", to: "" });
                  router.push(basePath);
                }}
              >
                清除篩選
              </Button>
            ) : null}
          </div>
        </div>
      </fieldset>
    </form>
  );
}

function SelectField({
  id,
  label,
  name,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: Option[];
}) {
  return (
    <div className="cc-field">
      <label className="cc-label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="cc-select"
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">全部</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.displayName}
          </option>
        ))}
      </select>
    </div>
  );
}
