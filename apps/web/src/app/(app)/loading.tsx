import { PageSkeleton } from "@workflow/ui";

/**
 * Shown while any signed-in page fetches.
 *
 * One placeholder for the whole group rather than a bespoke skeleton per route:
 * these pages all open with a heading and a stack of cards or rows, and a
 * placeholder that pretends to know the exact shape of a page it has not
 * loaded yet is a worse lie than an honest generic one.
 *
 * The shell stays put, because the navigation is not what is loading.
 */
export default function Loading() {
  return <PageSkeleton />;
}
