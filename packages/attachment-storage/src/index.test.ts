import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileAttachmentStorage } from "./index.js";

describe("filesystem attachment storage", () => {
  it("streams private objects, ranges, and idempotent deletion under its root", async () => {
    const root = await mkdtemp(join(tmpdir(), "workflow-attachment-storage-"));
    const source = join(root, "source.pdf");
    await writeFile(source, "%PDF-1.7\nprivate", { mode: 0o600 });
    const storage = new FileAttachmentStorage(join(root, "objects"));
    try {
      await expect(
        storage.put({ key: "../escape.pdf", sourcePath: source, sizeBytes: 16, sha256: "a".repeat(64) }),
      ).rejects.toThrow("Invalid attachment storage key");
      await storage.put({
        key: "attachments/sheet/object.pdf",
        sourcePath: source,
        sizeBytes: 16,
        sha256: "a".repeat(64),
      });
      await expect(
        storage.put({
          key: "attachments/sheet/object.pdf",
          sourcePath: source,
          sizeBytes: 16,
          sha256: "a".repeat(64),
        }),
      ).rejects.toThrow();
      expect(await storage.inspect({ key: "attachments/sheet/object.pdf" })).toEqual({
        sizeBytes: 16,
        sha256: "ca4d72b1672ff230f0ece138e373669738628bab1c0b043bc4a2062f9bc2cd6c",
      });
      const opened = await storage.open({
        key: "attachments/sheet/object.pdf",
        range: { start: 0, end: 4 },
      });
      const chunks: Buffer[] = [];
      for await (const chunk of opened.stream) chunks.push(Buffer.from(chunk));
      expect(Buffer.concat(chunks).toString("ascii")).toBe("%PDF-");
      expect(opened.contentLength).toBe(5);
      await storage.delete({ key: "attachments/sheet/object.pdf" });
      expect(await storage.inspect({ key: "attachments/sheet/object.pdf" })).toBeNull();
      await storage.delete({ key: "attachments/sheet/object.pdf" });
      await expect(readFile(join(root, "objects/attachments/sheet/object.pdf"))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
