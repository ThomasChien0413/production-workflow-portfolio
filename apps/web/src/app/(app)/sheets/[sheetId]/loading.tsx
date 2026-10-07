import { Skeleton } from "@workflow/ui";

/**
 * The sheet is the one page whose shape is worth mimicking: it is the slowest
 * (detail, staff, departments, handoff destinations and field history in
 * parallel) and the most recognisable, so a placeholder that reads as "your
 * form is coming" beats a generic stack of blocks.
 */
export default function LoadingSheet() {
  return (
    <main
      className="cc-page cc-stack"
      role="status"
      aria-busy="true"
      aria-live="polite"
      style={{ margin: "0 auto" }}
    >
      <span className="cc-sr-only">載入生產單中</span>
      <Skeleton height={14} width="30%" />
      <Skeleton height={28} width="45%" />
      <Skeleton height={16} width="60%" />

      {/* The bordered form, roughly as it will arrive: a title strip and rows. */}
      <div className="cc-formsheet" style={{ padding: "var(--cc-space-4)" }}>
        <div className="cc-stack" style={{ gap: "var(--cc-space-3)" }}>
          <Skeleton height={24} width="35%" />
          <Skeleton height={40} />
          <Skeleton height={40} />
          <Skeleton height={40} />
          <Skeleton height={40} />
        </div>
      </div>
    </main>
  );
}
