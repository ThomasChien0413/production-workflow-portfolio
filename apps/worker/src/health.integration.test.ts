import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDatabase, outboxJobs } from "@workflow/database";
import { PostgresWorkerHealthRepository } from "./health.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

/**
 * Other suites write outbox jobs into the same database at the same time.
 * Backlog is therefore asserted as a lower bound, with waiting jobs of a type
 * no worker claims; failures are placed in 2000, where nothing else writes,
 * so their window can be asserted exactly.
 */
describe.skipIf(!testDatabaseUrl)("worker health measurement with PostgreSQL", () => {
  it("counts due jobs, the oldest wait and terminal push failures in the window", async () => {
    const connection = createDatabase(testDatabaseUrl!, 2);
    const suffix = randomUUID();
    const now = new Date();
    const at = (iso: string) => new Date(`2000-01-01T${iso}Z`);
    const ids: string[] = [];

    try {
      const rows = await connection.db
        .insert(outboxJobs)
        .values([
          {
            jobType: "VITEST_WORKER_HEALTH",
            payload: {},
            deduplicationKey: `vitest-health-${suffix}:due`,
            availableAt: new Date(now.getTime() - 3_600_000),
          },
          {
            jobType: "VITEST_WORKER_HEALTH",
            payload: {},
            deduplicationKey: `vitest-health-${suffix}:later`,
            availableAt: new Date(now.getTime() + 3_600_000),
          },
          ...["00:00:30", "00:01:00", "00:01:30"].map((time) => ({
            jobType: "PUSH_NOTIFICATION",
            payload: {},
            state: "FAILED" as const,
            deduplicationKey: `vitest-health-${suffix}:failed-${time}`,
            completedAt: at(time),
          })),
          {
            // Failed, but not a push delivery.
            jobType: "VITEST_WORKER_HEALTH",
            payload: {},
            state: "FAILED" as const,
            deduplicationKey: `vitest-health-${suffix}:other-failed`,
            completedAt: at("00:00:45"),
          },
        ])
        .returning({ id: outboxJobs.id });
      ids.push(...rows.map((row) => row.id));

      const repository = new PostgresWorkerHealthRepository(connection.db);
      const current = await repository.measure(new Date(now.getTime() - 60_000), now);
      expect(current.outboxBacklog).toBeGreaterThanOrEqual(1);
      expect(current.outboxOldestDueSeconds).toBeGreaterThanOrEqual(3_600);

      // The window excludes its start and includes its end, so consecutive
      // windows count each failure once.
      const first = await repository.measure(at("00:00:00"), at("00:01:00"));
      const second = await repository.measure(at("00:01:00"), at("00:02:00"));
      expect(first.pushTerminalFailures).toBe(2);
      expect(second.pushTerminalFailures).toBe(1);
    } finally {
      if (ids.length > 0) {
        await connection.db.delete(outboxJobs).where(inArray(outboxJobs.id, ids));
      }
      await connection.close();
    }
  });
});
