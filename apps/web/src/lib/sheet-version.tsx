"use client";

import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";

type SheetVersion = {
  /** The newest version anything on the page has heard of, or the fallback. */
  latest: (fallback: number) => number;
  /** Record a version the server returned. */
  report: (version: number) => void;
};

const SheetVersionContext = createContext<SheetVersion | null>(null);

/**
 * The sheet's version, shared by every control on its page.
 *
 * Saving the form, setting the status, the 交期 and the subpage each move the
 * sheet's version, and each of the last three is refused unless it names the
 * current one. They sit in different parts of the page (the user,
 * 2026-09-30), so the page's copy can lag a write made a moment ago. Each
 * write reports the version it produced here, and each control writes against
 * the newest one heard of, without waiting for a page refresh.
 */
export function SheetVersionProvider({ children }: { children: ReactNode }) {
  const newest = useRef(0);
  const value = useMemo<SheetVersion>(
    () => ({
      latest: (fallback) => Math.max(fallback, newest.current),
      report: (version) => {
        if (version > newest.current) newest.current = version;
      },
    }),
    [],
  );
  return <SheetVersionContext.Provider value={value}>{children}</SheetVersionContext.Provider>;
}

export function useSheetVersion(): SheetVersion {
  return (
    useContext(SheetVersionContext) ?? {
      latest: (fallback) => fallback,
      report: () => undefined,
    }
  );
}
