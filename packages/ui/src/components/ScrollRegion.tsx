import type { ReactNode } from "react";

export type ScrollRegionProps = {
  /**
   * Names the region for screen readers and gives the focus stop a purpose.
   * Usually the same words as the table's caption.
   */
  label: string;
  children: ReactNode;
  /** Extra classes, e.g. the `cc-only-wide` responsive swap. */
  className?: string;
  /**
   * `table` adds the bordered table wrapper; `plain` keeps only the scrolling
   * behaviour for surfaces that bring their own frame, like the print-faithful
   * sheet.
   */
  variant?: "table" | "plain";
};

/**
 * A horizontally scrolling region that a keyboard can actually scroll.
 *
 * Any element with `overflow-x: auto` is operable by mouse and touch but not by
 * keyboard unless it is focusable — WCAG 2.1.1, and axe's
 * `scrollable-region-focusable`. A CSS class cannot enforce that, and the
 * omission is invisible until the content happens to be wider than the
 * viewport, so this is a component rather than a class: every scrolling
 * container in the product gets the tab stop and the accessible name by
 * construction.
 */
export function ScrollRegion({
  label,
  children,
  className,
  variant = "table",
}: ScrollRegionProps) {
  const classes = [variant === "table" ? "cc-table-wrap" : "cc-scroll-x"];
  if (className) classes.push(className);

  return (
    <div
      className={classes.join(" ")}
      role="region"
      aria-label={label}
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region must be keyboard-focusable to be scrolled without a pointer (WCAG 2.1.1).
      tabIndex={0}
    >
      {children}
    </div>
  );
}
