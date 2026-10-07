import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

export type BadgeProps = {
  tone?: BadgeTone;
  children: ReactNode;
  /** Decorative dot. The text label is always the real signal. */
  dot?: boolean;
};

/**
 * Status is never carried by colour alone (DESIGN.md section 3.1), so children
 * are required — there is deliberately no icon-only or dot-only variant.
 */
export function Badge({ tone = "neutral", children, dot = false }: BadgeProps) {
  return (
    <span className={`cc-badge cc-badge--${tone}`}>
      {dot ? <span className="cc-badge__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
