import { describe, expect, it, vi } from "vitest";
import { WorkerHealthReporter, type WorkerHealthRepository } from "./health.js";

const health = { outboxBacklog: 2, outboxOldestDueSeconds: 45, pushTerminalFailures: 1 };

function clock(start: number) {
  let current = start;
  return {
    now: () => new Date(current),
    advance(ms: number) {
      current += ms;
    },
  };
}

describe("worker health reporter", () => {
  it("writes one JSON line per interval, each covering the time since the last", async () => {
    const time = clock(Date.UTC(2026, 8, 30, 0, 0, 0));
    const start = time.now();
    const measure = vi.fn<WorkerHealthRepository["measure"]>().mockResolvedValue(health);
    const lines: string[] = [];
    const reporter = new WorkerHealthReporter({ measure }, 60_000, (line) => lines.push(line), time.now);

    await expect(reporter.reportIfDue()).resolves.toBe(true);
    time.advance(30_000);
    await expect(reporter.reportIfDue()).resolves.toBe(false);
    time.advance(30_000);
    await expect(reporter.reportIfDue()).resolves.toBe(true);

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toEqual({ event: "worker.health", ...health });
    expect(lines[0]!.endsWith("\n")).toBe(true);
    expect(measure.mock.calls[0]![0]).toEqual(start);
    // The second window starts where the first ended.
    expect(measure.mock.calls[1]![0]).toEqual(measure.mock.calls[0]![1]);
  });

  it("retries on the next cycle after a failed measurement, keeping the window", async () => {
    const time = clock(Date.UTC(2026, 8, 30, 0, 0, 0));
    const start = time.now();
    const measure = vi
      .fn<WorkerHealthRepository["measure"]>()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValue(health);
    const lines: string[] = [];
    const reporter = new WorkerHealthReporter({ measure }, 60_000, (line) => lines.push(line), time.now);

    await expect(reporter.reportIfDue()).rejects.toThrow("database unavailable");
    time.advance(5_000);
    await expect(reporter.reportIfDue()).resolves.toBe(true);

    expect(lines).toHaveLength(1);
    // A failure in the first window is still counted in the retried one.
    expect(measure.mock.calls[1]![0]).toEqual(start);
  });
});
