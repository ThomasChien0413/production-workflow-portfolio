"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** The width a sheet is laid out at on a phone: a desktop sheet's width. */
export const SHEET_FIT_WIDTH = 960;
/**
 * Below this much room a sheet is scaled rather than laid out to fit: the
 * printed grid needs 640px, so narrower than that it used to scroll sideways.
 */
export const SHEET_FIT_BELOW = 640;

/**
 * On a phone a sheet looks as it does on a desktop (the user, 2026-10-03): it
 * is laid out at a desktop width and drawn scaled down to the room there is,
 * and the reader pinches to zoom in. Wider screens lay it out as before.
 *
 * Scaled with a transform, not CSS `zoom`. `zoom` lays the sheet out again at
 * the smaller size, and WebKit — Safari, and every iPhone browser — then drops
 * its 1px rules, leaving a sheet with no box lines and text wrapped
 * differently. A transform lays it out once, as on a desktop, and shrinks the
 * drawing, so the rules stay as fine lines. A transform takes no room of its
 * own, so the outer box is given the scaled height, and clips the full-width
 * layout it would otherwise spill sideways. Until the page is interactive the
 * sheet renders unscaled, as it did.
 */
export function SheetFit({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ scale: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const room = outer.current;
    const page = inner.current;
    if (!room || !page) return;
    const update = () => {
      const width = room.clientWidth;
      if (width <= 0 || width >= SHEET_FIT_BELOW) {
        setFit(null);
        return;
      }
      const scale = width / SHEET_FIT_WIDTH;
      // offsetHeight is the untransformed layout height at the fit width.
      setFit({ scale, height: Math.ceil(page.offsetHeight * scale) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(room);
    observer.observe(page);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={outer}
      className="cc-sheetfit"
      data-scaled={fit ? "true" : undefined}
      style={fit ? { height: fit.height } : undefined}
    >
      <div
        ref={inner}
        className="cc-sheetfit__page"
        data-scaled={fit ? "true" : undefined}
        style={
          fit
            ? { width: SHEET_FIT_WIDTH, transform: `scale(${fit.scale})` }
            : undefined
        }
      >
        {children}
      </div>
    </div>
  );
}
