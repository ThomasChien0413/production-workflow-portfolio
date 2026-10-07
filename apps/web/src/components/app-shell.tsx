"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useId, useState, type ReactNode } from "react";

export type NavEntry = {
  href: string;
  label: string;
  /** Shown as a count beside the label, e.g. unread notifications. */
  badge?: number;
  /**
   * 審核's list is current on itself and on a sheet opened from it
   * (`?from=review`), not on every sheet page under /sheets: a 分條申請單 its
   * writer just sent for review is not the queue (the user, 2026-10-04).
   */
  match?: "review-queue";
};

/**
 * The application shell: one navigation landmark, placed differently by width.
 *
 * From 1024px it is a persistent sidebar. Below that it is a panel that opens
 * over the page from under the top bar, so the page does not move (the user,
 * 2026-10-03). It stays a disclosure rather than a modal: the links exist once
 * in the accessibility tree at every width and nothing traps focus. A dimmed
 * layer over the rest of the page closes it when tapped, as do the toggle and
 * Escape, so it cannot strand anyone.
 */
export function AppShell({
  entries,
  title,
  children,
}: {
  entries: NavEntry[];
  /** Shown in the mobile top bar, where there is no room for the brand. */
  title: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const navId = useId();

  // Navigating is the end of the menu's usefulness. Without this the panel
  // stays open over the page the operator just asked for.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  return (
    <div className="cc-shell">
      <header className="cc-topbar cc-shell__topbar">
        <button
          type="button"
          className="cc-icon-btn cc-shell__toggle"
          aria-expanded={open}
          aria-controls={navId}
          onClick={() => setOpen((previous) => !previous)}
        >
          {/* Three lines drawn, not the ☰ character: each phone draws that from
              its own font, and on an iPhone it sat off centre in the button. */}
          <svg className="cc-shell__toggle-icon" aria-hidden="true" viewBox="0 0 24 24" width="26" height="26">
            <path d="M4 6h16M4 12h16M4 18h16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span className="cc-sr-only">{open ? "關閉主選單" : "開啟主選單"}</span>
        </button>
        <span className="cc-topbar__title">{title}</span>
      </header>

      {open ? (
        // Tapping the page beside the open menu closes it. Not a control in
        // its own right: the toggle and Escape do the same for keyboards.
        <div className="cc-shell__scrim" aria-hidden="true" onClick={() => setOpen(false)} />
      ) : null}

      <nav
        id={navId}
        className="cc-sidebar cc-shell__nav"
        data-open={open ? "true" : "false"}
        aria-label="主導覽"
      >
        <div className="cc-sidebar__brand">
          {/* eslint-disable-next-line @next/next/no-img-element -- fixed brand
              artwork, not user content. */}
          <img
            className="cc-sidebar__logo"
            src="/brand/workflow-logo.svg"
            alt="Workflow Portfolio"
            width={87}
            height={32}
          />
        </div>
        {/* Reading the address's query suspends; until then the links mark
            the current page by its path alone. */}
        <Suspense fallback={<NavLinks entries={entries} pathname={pathname} fromReview={false} />}>
          <NavLinksFromAddress entries={entries} pathname={pathname} />
        </Suspense>
      </nav>

      <div className="cc-shell__main">{children}</div>
    </div>
  );
}

function NavLinksFromAddress({ entries, pathname }: { entries: NavEntry[]; pathname: string }) {
  const fromReview = useSearchParams().get("from") === "review";
  return <NavLinks entries={entries} pathname={pathname} fromReview={fromReview} />;
}

function NavLinks({
  entries,
  pathname,
  fromReview,
}: {
  entries: NavEntry[];
  pathname: string;
  fromReview: boolean;
}) {
  /** `/notifications` stays current on its children, but `/` only on `/`. */
  const isCurrent = (entry: NavEntry) => {
    if (entry.href === "/") return pathname === "/";
    if (pathname === entry.href) return true;
    const child = pathname.startsWith(`${entry.href}/`);
    return entry.match === "review-queue" ? child && fromReview : child;
  };
  return (
    <>
      {entries.map((entry) => (
        <Link
          key={entry.href}
          href={entry.href}
          className="cc-nav-item"
          aria-current={isCurrent(entry) ? "page" : undefined}
        >
          {entry.label}
          {entry.badge && entry.badge > 0 ? (
            <span className="cc-count cc-nav-item__badge">
              {entry.badge}
              <span className="cc-sr-only">則未讀</span>
            </span>
          ) : null}
        </Link>
      ))}
    </>
  );
}
