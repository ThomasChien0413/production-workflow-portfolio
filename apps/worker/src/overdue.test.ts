import { describe, expect, it, vi } from "vitest";
import {
  getTaipeiReminderWindow,
  OverdueReminderProducer,
  type OverdueReminderRepository,
} from "./overdue.js";

describe("Taipei overdue reminder schedule", () => {
  it("opens the daily window at exactly 09:00 Taipei", () => {
    expect(
      getTaipeiReminderWindow(new Date("2026-08-10T00:59:59.999Z")),
    ).toEqual({
      dateKey: "2026-08-10",
      cutoffAt: new Date("2026-08-10T01:00:00.000Z"),
      due: false,
    });
    expect(
      getTaipeiReminderWindow(new Date("2026-08-10T01:00:00.000Z")),
    ).toEqual({
      dateKey: "2026-08-10",
      cutoffAt: new Date("2026-08-10T01:00:00.000Z"),
      due: true,
    });
  });

  it("uses the Taipei calendar date across the UTC day boundary", () => {
    expect(
      getTaipeiReminderWindow(new Date("2026-08-09T17:00:00.000Z")),
    ).toMatchObject({ dateKey: "2026-08-10", due: false });
  });

  it("runs once after a successful scan and retries after a failure", async () => {
    const createForCutoff = vi
      .fn<OverdueReminderRepository["createForCutoff"]>()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValue({
        sheetsScanned: 2,
        recipientsCreated: 3,
        notificationsCreated: 6,
      });
    const producer = new OverdueReminderProducer({ createForCutoff });
    const scanTime = new Date("2026-08-10T05:00:00.000Z");

    await expect(producer.runIfDue(scanTime)).rejects.toThrow("database unavailable");
    await expect(producer.runIfDue(scanTime)).resolves.toMatchObject({
      dateKey: "2026-08-10",
      status: "SCANNED",
      sheetsScanned: 2,
      recipientsCreated: 3,
    });
    await expect(producer.runIfDue(scanTime)).resolves.toMatchObject({
      status: "ALREADY_SCANNED",
      notificationsCreated: 0,
    });
    expect(createForCutoff).toHaveBeenCalledTimes(2);
    expect(createForCutoff).toHaveBeenLastCalledWith(
      "2026-08-10",
      new Date("2026-08-10T01:00:00.000Z"),
      scanTime,
    );
  });

  it("does not touch the repository before 09:00 Taipei", async () => {
    const createForCutoff = vi.fn<OverdueReminderRepository["createForCutoff"]>();
    const result = await new OverdueReminderProducer({ createForCutoff }).runIfDue(
      new Date("2026-08-10T00:59:59.999Z"),
    );
    expect(result.status).toBe("NOT_DUE");
    expect(createForCutoff).not.toHaveBeenCalled();
  });
});
