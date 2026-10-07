import Link from "next/link";

type TabSubpage = { id: string; name: string; sheetCount: number; capabilities: { canView: boolean } };

/**
 * The department's subpages as one horizontal bar of links (the user,
 * 2026-09-30), each subpage its own page; there is no `全部` across them
 * (the user, 2026-10-03). Links,
 * not a tablist — each tab changes the URL, so it can be bookmarked, shared,
 * opened in a new window and reached with the back button. The bar scrolls on
 * its own when the names outrun a phone; every tab is a link, so the keyboard
 * reaches all of them and focus scrolls them into view.
 */
export function SubpageTabs({
  slug,
  subpages,
  current,
}: {
  slug: string;
  subpages: TabSubpage[];
  /** The subpage being shown. */
  current: string;
}) {
  const visible = subpages.filter((subpage) => subpage.capabilities.canView);
  if (visible.length === 0) return null;
  const tabs = visible.map((subpage) => ({
    key: subpage.id,
    label: subpage.name,
    href: `/departments/${slug}/subpages/${subpage.id}`,
    count: subpage.sheetCount,
    selected: subpage.id === current,
  }));
  return (
    <nav className="cc-tabs cc-subpage-tabs" aria-label="工作子分頁">
      {tabs.map((tab) => (
        <Link key={tab.key} href={tab.href} className="cc-tab" aria-current={tab.selected ? "page" : undefined}>
          {tab.label}
          <span className="cc-count cc-count--neutral">
            {tab.count}
            <span className="cc-sr-only">張生產單</span>
          </span>
        </Link>
      ))}
    </nav>
  );
}
