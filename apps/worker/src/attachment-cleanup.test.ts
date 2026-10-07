import { describe, expect, it, vi } from "vitest";
import type { AttachmentStorage } from "@workflow/attachment-storage";
import { AttachmentCleanupProcessor } from "./attachment-cleanup.js";

describe("attachment cleanup processor", () => {
  it("deletes the exact private object version and records success", async () => {
    const repository = {
      success: vi.fn(async () => {}),
      retry: vi.fn(async () => {}),
      invalid: vi.fn(async () => {}),
    };
    const storage: AttachmentStorage = {
      put: vi.fn(),
      open: vi.fn(),
      inspect: vi.fn(),
      delete: vi.fn(async () => {}),
    };
    const processor = new AttachmentCleanupProcessor(repository as never, storage, 1_000, 60_000);
    const job = {
      id: "29d1e7f1-cffc-4ea9-9281-fb3257c11b7d",
      attempts: 1,
      payload: {
        attachmentId: "8b500479-8c6d-4025-a19b-3b34b77a93c8",
        storageKey: "attachments/sheet/object.pdf",
        storageVersionId: "version-1",
      },
    };
    await processor.process(job);
    expect(storage.delete).toHaveBeenCalledWith({
      key: "attachments/sheet/object.pdf",
      versionId: "version-1",
    });
    expect(repository.success).toHaveBeenCalledWith(job, job.payload.attachmentId);
    expect(repository.retry).not.toHaveBeenCalled();
  });

  it("retries physical deletion without a terminal attempt limit", async () => {
    const repository = {
      success: vi.fn(async () => {}),
      retry: vi.fn(async () => {}),
      invalid: vi.fn(async () => {}),
    };
    const storage: AttachmentStorage = {
      put: vi.fn(),
      open: vi.fn(),
      inspect: vi.fn(),
      delete: vi.fn(async () => {
        throw new Error("S3 unavailable");
      }),
    };
    const now = new Date("2026-08-18T00:00:00.000Z");
    const processor = new AttachmentCleanupProcessor(
      repository as never,
      storage,
      1_000,
      60_000,
      () => now,
    );
    const job = {
      id: "29d1e7f1-cffc-4ea9-9281-fb3257c11b7d",
      attempts: 99,
      payload: {
        attachmentId: "8b500479-8c6d-4025-a19b-3b34b77a93c8",
        storageKey: "attachments/sheet/object.pdf",
        storageVersionId: null,
      },
    };
    await processor.process(job);
    expect(repository.retry).toHaveBeenCalledWith(
      job,
      job.payload.attachmentId,
      new Date(now.getTime() + 60_000),
      "Error",
    );
    expect(repository.success).not.toHaveBeenCalled();
  });
});
