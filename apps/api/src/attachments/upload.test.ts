import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import multipart from "@fastify/multipart";
import { SHEET_ATTACHMENT_MAX_UPLOAD_BYTES } from "@workflow/contracts";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { readPdfMultipartToTemp } from "./upload.js";

function pdfRequest(size: number): Readable {
  return Readable.from((function* () {
    yield Buffer.from('--test-boundary\r\nContent-Disposition: form-data; name="file"; filename="limit.pdf"\r\nContent-Type: application/pdf\r\n\r\n');
    yield Buffer.from("%PDF-");
    const chunk = Buffer.alloc(64 * 1024, 32);
    for (let remaining = size - 5; remaining > 0; remaining -= chunk.length) {
      yield chunk.subarray(0, Math.min(remaining, chunk.length));
    }
    yield Buffer.from("\r\n--test-boundary--\r\n");
  })());
}

describe("streamed PDF upload size boundary", () => {
  it("accepts exactly 95 MB and rejects one byte more without leaving temporary files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "workflow-upload-cap-"));
    const app = Fastify();
    try {
      await app.register(multipart, { throwFileSizeLimit: true });
      app.post("/upload", async (request) => {
        const prepared = await readPdfMultipartToTemp(request, directory, SHEET_ATTACHMENT_MAX_UPLOAD_BYTES);
        const bytes = (await stat(prepared.tempPath)).size;
        await rm(prepared.tempPath);
        return { bytes, hash: prepared.sha256 };
      });
      const accepted = await app.inject({
        method: "POST", url: "/upload",
        headers: { "content-type": "multipart/form-data; boundary=test-boundary" },
        payload: pdfRequest(SHEET_ATTACHMENT_MAX_UPLOAD_BYTES),
      });
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json().bytes).toBe(95_000_000);
      const expectedHash = createHash("sha256").update("%PDF-");
      const chunk = Buffer.alloc(64 * 1024, 32);
      for (let remaining = 95_000_000 - 5; remaining > 0; remaining -= chunk.length) {
        expectedHash.update(chunk.subarray(0, Math.min(remaining, chunk.length)));
      }
      expect(accepted.json().hash).toBe(expectedHash.digest("hex"));
      const rejected = await app.inject({
        method: "POST", url: "/upload",
        headers: { "content-type": "multipart/form-data; boundary=test-boundary" },
        payload: pdfRequest(SHEET_ATTACHMENT_MAX_UPLOAD_BYTES + 1),
      });
      expect(rejected.statusCode).toBe(409);
      expect(rejected.json().message).toBe("附件不可超過 95 MB");
      expect(await readdir(directory)).toEqual([]);
    } finally {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
