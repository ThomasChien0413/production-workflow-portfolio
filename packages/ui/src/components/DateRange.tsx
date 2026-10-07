import { useId } from "react";
import type { ReactNode } from "react";

export type DateRangeValue = {
  /** `YYYY-MM-DD`, or "" for an open end. */
  from: string;
  to: string;
};

export type DateRangePreset = {
  label: string;
  from: string;
  to: string;
};

export type DateRangeProps = {
  /** Names the pair. Screen readers read it before each input's own label. */
  legend: string;
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  fromLabel?: string;
  toLabel?: string;
  help?: ReactNode;
  /** Shown once for the pair and attached to the start input. */
  error?: ReactNode;
  /**
   * Ready-made ranges, already resolved to dates by the caller. The component
   * never computes "today": which day it is depends on a time zone, and that
   * belongs to the application, not to a shared control.
   */
  presets?: DateRangePreset[];
  fromName?: string;
  toName?: string;
};

/**
 * A date range as one labelled group.
 *
 * Two separate `Field`s would be two unrelated questions. A range is one
 * question with two halves: the legend names it, the error belongs to the pair
 * rather than to either input, and the presets set both ends at once.
 *
 * Native `type="date"` on purpose — it brings the platform date picker, the
 * user's own date format, and full keyboard support, none of which a custom
 * calendar would match without a great deal of code.
 */
export function DateRange({
  legend,
  value,
  onChange,
  fromLabel = "開始日期",
  toLabel = "結束日期",
  help,
  error,
  presets = [],
  fromName,
  toName,
}: DateRangeProps) {
  const id = useId();
  const fromId = `${id}-from`;
  const toId = `${id}-to`;
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;

  const describedBy = [help ? helpId : null, error ? errorId : null]
    .filter((value): value is string => value !== null)
    .join(" ");

  return (
    <fieldset className="cc-daterange">
      <legend className="cc-daterange__legend">{legend}</legend>

      <div className="cc-daterange__pair">
        <div className="cc-field">
          <label className="cc-label" htmlFor={fromId}>
            {fromLabel}
          </label>
          <input
            id={fromId}
            name={fromName}
            className="cc-input cc-tnum"
            type="date"
            value={value.from}
            onChange={(event) => onChange({ ...value, from: event.target.value })}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy === "" ? undefined : describedBy}
          />
        </div>
        <div className="cc-field">
          <label className="cc-label" htmlFor={toId}>
            {toLabel}
          </label>
          <input
            id={toId}
            name={toName}
            className="cc-input cc-tnum"
            type="date"
            value={value.to}
            onChange={(event) => onChange({ ...value, to: event.target.value })}
            aria-describedby={describedBy === "" ? undefined : describedBy}
          />
        </div>
      </div>

      {presets.length > 0 ? (
        <div className="cc-daterange__presets">
          {presets.map((preset) => {
            // aria-pressed rather than a visual highlight alone, so the active
            // range is reported and not merely coloured.
            const active = preset.from === value.from && preset.to === value.to;
            return (
              <button
                key={preset.label}
                type="button"
                className="cc-btn cc-btn--tertiary"
                aria-pressed={active}
                onClick={() => onChange({ from: preset.from, to: preset.to })}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {help ? (
        <p className="cc-help" id={helpId}>
          {help}
        </p>
      ) : null}
      {error ? (
        <p className="cc-error" id={errorId}>
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
