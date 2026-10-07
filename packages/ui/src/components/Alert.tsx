import type { ReactNode } from "react";

export type AlertTone = "info" | "success" | "warning" | "danger";

export type AlertProps = {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  /**
   * Announce immediately. Reserve for errors and conflicts; anything a user is
   * merely reading should stay silent so screen readers are not interrupted.
   */
  assertive?: boolean;
  actions?: ReactNode;
};

const ICON: Record<AlertTone, ReactNode> = {
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  success: <path d="M20 6 9 17l-5-5" />,
  warning: (
    <>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  danger: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15 9-6 6M9 9l6 6" />
    </>
  ),
};

export function Alert({
  tone = "info",
  title,
  children,
  assertive = false,
  actions,
}: AlertProps) {
  const classes = ["cc-alert"];
  if (tone !== "info") classes.push(`cc-alert--${tone}`);

  return (
    <div className={classes.join(" ")} role={assertive ? "alert" : undefined}>
      <svg
        className="cc-alert__icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {ICON[tone]}
      </svg>
      <div className="cc-alert__body">
        {title ? <p className="cc-alert__title">{title}</p> : null}
        {children ? <div className="cc-alert__text">{children}</div> : null}
        {actions ? (
          <div className="cc-row" style={{ marginTop: "var(--cc-space-2)" }}>
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}
