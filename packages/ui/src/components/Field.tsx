import { useId } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";

export type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & {
  label: string;
  help?: ReactNode;
  /** When present the control is marked invalid and the message is announced. */
  error?: ReactNode;
  /** Shows the required marker and the screen-reader-only word 必填. */
  requiredMark?: boolean;
  optionalMark?: boolean;
};

/**
 * Label, control, help text and error message wired together.
 *
 * DESIGN.md section 3.4 requires every control to have a programmatic
 * Traditional Chinese label and connected validation text, so the wiring lives
 * here rather than being repeated — and forgotten — at each call site.
 */
export function Field({
  label,
  help,
  error,
  requiredMark = false,
  optionalMark = false,
  className,
  ...rest
}: FieldProps) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;

  const describedBy = [help ? helpId : null, error ? errorId : null]
    .filter((value): value is string => value !== null)
    .join(" ");

  const inputClasses = ["cc-input"];
  if (className) inputClasses.push(className);

  return (
    <div className="cc-field">
      <label className="cc-label" htmlFor={id}>
        {label}
        {requiredMark ? (
          <>
            <span className="cc-label__required" aria-hidden="true">
              *
            </span>
            <span className="cc-sr-only">必填</span>
          </>
        ) : null}
        {optionalMark ? <span className="cc-label__optional">（選填）</span> : null}
      </label>
      <input
        id={id}
        className={inputClasses.join(" ")}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy === "" ? undefined : describedBy}
        {...rest}
      />
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
    </div>
  );
}
