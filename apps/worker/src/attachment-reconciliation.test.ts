import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { AttachmentStorage } from "@workflow/attachment-storage";
import { reconcileAvailableAttachments } from "./attachment-reconciliation.js";

function storage(
  inspect: AttachmentStorage["inspect"],
): AttachmentStorage {
  return {
    inspect,
    async put() { return { versionId: null }; },
    async open() { return { stream: Readable.from([]), contentLength: 0 }; },
    async delete() {},
  };
}

const record = {
  id: "attachment-1",
  storageKey: "attachments/sheet/object.pdf",
  storageVersionId: null,
  sizeBytes: 12,
  sha256: "a".repeat(64),
};

describe("attachment recovery reconciliation", () => {
  it("accepts an exact private-object match", async () => {
    await expect(
      reconcileAvailableAttachments(
        [record],
        storage(async () => ({ sizeBytes: 12, sha256: "a".repeat(64) })),
      ),
    ).resolves.toEqual({ checked: 1, issues: [] });
  });

  it.each([
    [null, "MISSING"],
    [{ sizeBytes: 11, sha256: "a".repeat(64) }, "SIZE_MISMATCH"],
    [{ sizeBytes: 12, sha256: null }, "CHECKSUM_UNAVAILABLE"],
    [{ sizeBytes: 12, sha256: "b".repeat(64) }, "HASH_MISMATCH"],
  ] as const)("reports %s as %s", async (object, kind) => {
    const result = await reconcileAvailableAttachments(
      [record],
      storage(async () => object),
    );
    expect(result.issues).toEqual([{ attachmentId: record.id, kind }]);
  });

  it("reports storage failures without exposing their message", async () => {
    const result = await reconcileAvailableAttachments(
      [record],
      storage(async () => { throw new Error("secret object coordinate"); }),
    );
    expect(result.issues).toEqual([
      { attachmentId: record.id, kind: "STORAGE_ERROR" },
    ]);
  });
});
