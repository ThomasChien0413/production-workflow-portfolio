import { describe, expect, it, vi } from "vitest";
import { PushSendError, classifyPushFailure, type PushClient } from "./push-client.js";
import {
  OutboxProcessor,
  type ClaimedOutboxJob,
  type OutboxRepository,
  type PushDelivery,
} from "./outbox.js";

// Phone and browser push replaced LINE (the user, 2026-10-04).
const job: ClaimedOutboxJob = {
  id: "123e4567-e89b-12d3-a456-426614174000",
  jobType: "PUSH_NOTIFICATION",
  payload: { notificationId: "223e4567-e89b-12d3-a456-426614174000" },
  attempts: 1,
};

const phone = { id: "phone", endpoint: "https://push.example/phone", p256dh: "p1", auth: "a1" };
const laptop = { id: "laptop", endpoint: "https://push.example/laptop", p256dh: "p2", auth: "a2" };

const delivery: PushDelivery = {
  notificationId: "223e4567-e89b-12d3-a456-426614174000",
  notificationState: "PENDING",
  recipientActive: true,
  summary: "生產單已逾期，請確認目前進度。",
  deepLink: "/sheets/1",
  devices: [phone, laptop],
};

function createRepository(overrides: Partial<OutboxRepository> = {}) {
  return {
    claim: vi.fn().mockResolvedValue([]),
    getPushDelivery: vi.fn().mockResolvedValue(delivery),
    recordDevices: vi.fn().mockResolvedValue(undefined),
    completeAlreadyHandled: vi.fn().mockResolvedValue(undefined),
    recordSuccess: vi.fn().mockResolvedValue(undefined),
    recordRetry: vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn().mockResolvedValue(undefined),
    recordNoDevice: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } satisfies OutboxRepository;
}

function createProcessor(repository: OutboxRepository, send: PushClient["send"]) {
  return new OutboxProcessor(
    repository,
    { send },
    { maxAttempts: 3, retryBaseMs: 1_000, retryMaxMs: 10_000 },
    () => new Date("2026-08-08T00:00:00.000Z"),
  );
}

describe("push outbox processor", () => {
  it("sends the notice, never the sheet, to every device and records it delivered", async () => {
    const repository = createRepository();
    const send = vi.fn().mockResolvedValue(undefined);
    await createProcessor(repository, send).process(job);

    const message = {
      title: "Workflow Portfolio",
      body: "生產單已逾期，請確認目前進度。",
      url: "/sheets/1",
      tag: delivery.notificationId,
    };
    expect(send).toHaveBeenNthCalledWith(1, phone, message);
    expect(send).toHaveBeenNthCalledWith(2, laptop, message);
    expect(repository.recordDevices).toHaveBeenCalledWith(["phone", "laptop"], []);
    expect(repository.recordSuccess).toHaveBeenCalledWith(job, delivery.notificationId);
  });

  it("counts one device taking it as delivered, and forgets a device that is gone", async () => {
    const repository = createRepository();
    const send = vi
      .fn()
      .mockRejectedValueOnce(classifyPushFailure(410))
      .mockResolvedValueOnce(undefined);
    await createProcessor(repository, send).process(job);

    expect(repository.recordDevices).toHaveBeenCalledWith(["laptop"], ["phone"]);
    expect(repository.recordSuccess).toHaveBeenCalledWith(job, delivery.notificationId);
    expect(repository.recordRetry).not.toHaveBeenCalled();
  });

  it("schedules bounded exponential retry when no device took it and a retry may help", async () => {
    const repository = createRepository();
    const send = vi.fn().mockRejectedValue(classifyPushFailure(503));
    await createProcessor(repository, send).process({ ...job, attempts: 2 });

    expect(repository.recordRetry).toHaveBeenCalledWith(
      { ...job, attempts: 2 },
      delivery.notificationId,
      new Date("2026-08-08T00:00:02.000Z"),
      503,
      "Push service returned HTTP 503",
    );
  });

  it("stops retrying after the configured attempt limit", async () => {
    const repository = createRepository();
    const send = vi.fn().mockRejectedValue(new PushSendError("Push request failed", true));
    const lastAttempt = { ...job, attempts: 3 };
    await createProcessor(repository, send).process(lastAttempt);

    expect(repository.recordRetry).not.toHaveBeenCalled();
    expect(repository.recordFailure).toHaveBeenCalledWith(
      lastAttempt,
      delivery.notificationId,
      "RETRIES_EXHAUSTED",
      null,
      "Push request failed",
    );
  });

  it("fails for good on a refusal no retry will fix", async () => {
    const repository = createRepository({
      getPushDelivery: vi.fn().mockResolvedValue({ ...delivery, devices: [phone] }),
    });
    const send = vi.fn().mockRejectedValue(classifyPushFailure(403));
    await createProcessor(repository, send).process(job);

    expect(repository.recordFailure).toHaveBeenCalledWith(
      job,
      delivery.notificationId,
      "TERMINAL_FAILURE",
      403,
      "Push service returned HTTP 403",
    );
  });

  it("closes the job without a failure when the recipient has no device, or every device is gone", async () => {
    const none = createRepository({
      getPushDelivery: vi.fn().mockResolvedValue({ ...delivery, devices: [] }),
    });
    const send = vi.fn();
    await createProcessor(none, send).process(job);
    expect(send).not.toHaveBeenCalled();
    expect(none.recordNoDevice).toHaveBeenCalledWith(job, delivery.notificationId);
    expect(none.recordFailure).not.toHaveBeenCalled();

    const allGone = createRepository();
    await createProcessor(allGone, vi.fn().mockRejectedValue(classifyPushFailure(404))).process(job);
    expect(allGone.recordDevices).toHaveBeenCalledWith([], ["phone", "laptop"]);
    expect(allGone.recordNoDevice).toHaveBeenCalledWith(job, delivery.notificationId);
  });

  it("never delivers queued notices to a deactivated account", async () => {
    const repository = createRepository({
      getPushDelivery: vi.fn().mockResolvedValue({ ...delivery, recipientActive: false }),
    });
    const send = vi.fn();
    await createProcessor(repository, send).process(job);

    expect(send).not.toHaveBeenCalled();
    expect(repository.recordFailure).toHaveBeenCalledWith(
      job,
      delivery.notificationId,
      "RECIPIENT_INACTIVE",
      null,
      "Recipient account is inactive",
    );
  });

  it("does not resend a notice already marked delivered", async () => {
    const repository = createRepository({
      getPushDelivery: vi.fn().mockResolvedValue({ ...delivery, notificationState: "DELIVERED" }),
    });
    const send = vi.fn();
    await createProcessor(repository, send).process(job);

    expect(send).not.toHaveBeenCalled();
    expect(repository.completeAlreadyHandled).toHaveBeenCalledWith(job);
  });

  it("classifies push service answers", () => {
    expect(classifyPushFailure(410)).toMatchObject({ gone: true, retryable: false });
    expect(classifyPushFailure(404)).toMatchObject({ gone: true, retryable: false });
    expect(classifyPushFailure(429)).toMatchObject({ gone: false, retryable: true });
    expect(classifyPushFailure(500)).toMatchObject({ gone: false, retryable: true });
    expect(classifyPushFailure(400)).toMatchObject({ gone: false, retryable: false });
    expect(classifyPushFailure(null)).toMatchObject({ gone: false, retryable: true });
  });
});
