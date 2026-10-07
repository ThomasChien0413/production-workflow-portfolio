import { and, count, eq, gt, inArray, lte, min } from "drizzle-orm";
import { outboxJobs, type Database } from "@workflow/database";

/**
 * What CloudWatch cannot see for itself: the outbox's due backlog and the
 * push notifications that failed for good. The worker writes one JSON line of
 * these every interval, and the production stack's metric filters turn the
 * line into metrics and alarms (`deploy/aws/workflow-production.yaml`).
 *
 * Counts only, never recipients, payloads or errors.
 */
export type WorkerHealth = {
  /** Jobs that are due now, waiting or claimed. */
  outboxBacklog: number;
  /** Age of the longest-waiting due job, 0 when there is none. */
  outboxOldestDueSeconds: number;
  /** Push notifications that failed for good since the previous line. */
  pushTerminalFailures: number;
};

export interface WorkerHealthRepository {
  measure(since: Date, now: Date): Promise<WorkerHealth>;
}

export class PostgresWorkerHealthRepository implements WorkerHealthRepository {
  constructor(private readonly db: Database) {}

  async measure(since: Date, now: Date): Promise<WorkerHealth> {
    const [[backlog], [failures]] = await Promise.all([
      this.db
        .select({ jobs: count(), oldest: min(outboxJobs.availableAt) })
        .from(outboxJobs)
        .where(
          and(
            inArray(outboxJobs.state, ["PENDING", "PROCESSING"]),
            lte(outboxJobs.availableAt, now),
          ),
        ),
      this.db
        .select({ jobs: count() })
        .from(outboxJobs)
        .where(
          and(
            eq(outboxJobs.jobType, "PUSH_NOTIFICATION"),
            eq(outboxJobs.state, "FAILED"),
            gt(outboxJobs.completedAt, since),
            lte(outboxJobs.completedAt, now),
          ),
        ),
    ]);
    const oldest = backlog?.oldest ? new Date(backlog.oldest) : null;
    return {
      outboxBacklog: backlog?.jobs ?? 0,
      outboxOldestDueSeconds: oldest
        ? Math.max(0, Math.floor((now.getTime() - oldest.getTime()) / 1000))
        : 0,
      pushTerminalFailures: failures?.jobs ?? 0,
    };
  }
}

export class WorkerHealthReporter {
  private since: Date;
  private nextAt = 0;

  constructor(
    private readonly repository: WorkerHealthRepository,
    private readonly intervalMs: number,
    private readonly write: (line: string) => void = (line) => {
      process.stdout.write(line);
    },
    private readonly now: () => Date = () => new Date(),
  ) {
    this.since = this.now();
  }

  /**
   * Writes the line when an interval has passed. A failed measurement moves
   * nothing forward, so the next cycle retries and no failure is skipped.
   */
  async reportIfDue(): Promise<boolean> {
    const now = this.now();
    if (now.getTime() < this.nextAt) return false;
    const health = await this.repository.measure(this.since, now);
    this.write(`${JSON.stringify({ event: "worker.health", ...health })}\n`);
    this.since = now;
    this.nextAt = now.getTime() + this.intervalMs;
    return true;
  }
}
