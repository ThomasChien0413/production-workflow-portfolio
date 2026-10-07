export type SkeletonProps = {
  /** Height of the block, e.g. `"1rem"` or `40`. */
  height?: string | number;
  width?: string | number;
  /** Rounded like a chip rather than a line of text. */
  pill?: boolean;
};

/**
 * A placeholder block for content that is on its way.
 *
 * Decorative by definition: it is `aria-hidden`, and the region that contains it
 * carries the announcement instead. A screen reader should hear "載入中" once,
 * not a description of every grey rectangle.
 */
export function Skeleton({ height = "1rem", width = "100%", pill }: SkeletonProps) {
  return (
    <span
      className="cc-skeleton"
      aria-hidden="true"
      style={{
        display: "block",
        height: typeof height === "number" ? `${height}px` : height,
        width: typeof width === "number" ? `${width}px` : width,
        borderRadius: pill ? "var(--cc-radius-full)" : undefined,
      }}
    />
  );
}

/**
 * The standard page placeholder: a heading, a few lines, and a block.
 *
 * One announcement for the whole region — `aria-busy` plus a polite live label
 * — so assistive technology says the page is loading once and then reads the
 * real content when it arrives.
 */
export function PageSkeleton({ label = "載入中" }: { label?: string }) {
  return (
    <div
      className="cc-page cc-stack"
      role="status"
      aria-busy="true"
      aria-live="polite"
      style={{ margin: "0 auto" }}
    >
      <span className="cc-sr-only">{label}</span>
      <Skeleton height={28} width="40%" />
      <Skeleton height={16} width="25%" />
      <div className="cc-stack" style={{ gap: "var(--cc-space-3)" }}>
        <Skeleton height={72} />
        <Skeleton height={72} />
        <Skeleton height={72} />
      </div>
    </div>
  );
}
