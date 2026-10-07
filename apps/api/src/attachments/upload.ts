import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FastifyRequest } from "fastify";
import { ConflictError } from "../auth/errors.js";
import { normalizeAttachmentFilename } from "./http.js";
import type { PreparedAttachmentUpload } from "./service.js";

const ACCEPTED_TYPES = new Set(["application/pdf", "application/octet-stream"]);

export async function readPdfMultipartToTemp(
  request: FastifyRequest,
  tempDirectory: string,
  maximumBytes: number,
): Promise<PreparedAttachmentUpload> {
  await mkdir(tempDirectory, { recursive: true, mode: 0o700 });
  let prepared: PreparedAttachmentUpload | null = null;
  let tempPath: string | null = null;
  try {
    for await (const part of request.parts({
      // One lookahead byte avoids marking an exactly-at-cap file truncated.
      // The streaming inspector rejects anything larger than the inclusive cap.
      limits: { files: 2, fields: 0, fileSize: maximumBytes + 1 },
    })) {
      if (part.type !== "file") {
        throw new ConflictError("附件上傳不可包含其他表單欄位");
      }
      if (prepared) {
        part.file.resume();
        throw new ConflictError("一次只能上傳一個 PDF 附件");
      }
      const filename = normalizeAttachmentFilename(part.filename);
      if (!/\.pdf$/iu.test(part.filename.trim())) {
        part.file.resume();
        throw new ConflictError("附件檔名必須使用 .pdf 副檔名");
      }
      if (!ACCEPTED_TYPES.has(part.mimetype.toLowerCase())) {
        part.file.resume();
        throw new ConflictError("附件內容類型必須是 PDF");
      }

      tempPath = join(tempDirectory, `${randomUUID()}.upload`);
      const hash = createHash("sha256");
      let sizeBytes = 0;
      let signature = Buffer.alloc(0);
      const inspect = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          sizeBytes += chunk.length;
          if (sizeBytes > maximumBytes) {
            callback(new ConflictError(`附件不可超過 ${maximumBytes / 1_000_000} MB`));
            return;
          }
          hash.update(chunk);
          if (signature.length < 5) {
            signature = Buffer.concat([signature, chunk]).subarray(0, 5);
          }
          callback(null, chunk);
        },
      });
      await pipeline(
        part.file,
        inspect,
        createWriteStream(tempPath, { flags: "wx", mode: 0o600 }),
      );
      if (part.file.truncated || sizeBytes > maximumBytes) {
        throw new ConflictError(`附件不可超過 ${maximumBytes / 1_000_000} MB`);
      }
      if (sizeBytes === 0) throw new ConflictError("附件不可為空白檔案");
      if (!signature.equals(Buffer.from("%PDF-", "ascii"))) {
        throw new ConflictError("附件內容不是有效的 PDF 檔案");
      }
      prepared = {
        tempPath,
        filename,
        sizeBytes,
        sha256: hash.digest("hex"),
      };
    }
    if (!prepared) throw new ConflictError("請選擇一個 PDF 附件");
    return prepared;
  } catch (error) {
    if (tempPath) await rm(tempPath, { force: true });
    throw error;
  }
}
