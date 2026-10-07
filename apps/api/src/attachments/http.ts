import { basename } from "node:path";
import type { AttachmentByteRange } from "@workflow/attachment-storage";

export class AttachmentRangeError extends Error {
  readonly statusCode = 416;

  constructor(readonly sizeBytes: number) {
    super("附件讀取範圍無效");
    this.name = "AttachmentRangeError";
  }
}

function replaceLoneSurrogates(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        result += value.slice(index, index + 2);
        index += 1;
      } else {
        result += "�";
      }
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      result += "�";
    } else {
      result += value.slice(index, index + 1);
    }
  }
  return result;
}

export function normalizeAttachmentFilename(input: string): string {
  const leaf = basename(replaceLoneSurrogates(input).replaceAll("\\", "/"))
    .normalize("NFKC")
    // oxlint-disable-next-line no-control-regex -- control characters are what a filename must not carry.
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  const candidate = leaf === "" ? "attachment.pdf" : leaf;
  const withExtension = /\.pdf$/iu.test(candidate)
    ? candidate
    : `${candidate}.pdf`;
  const characters = Array.from(withExtension);
  if (characters.length <= 255) return withExtension;
  const stem = Array.from(withExtension.replace(/\.pdf$/iu, ""));
  return `${stem.slice(0, 251).join("")}.pdf`;
}

export function attachmentContentDisposition(
  disposition: "inline" | "attachment",
  filename: string,
): string {
  const ascii = filename
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/gu, "_")
    .replace(/["\\]/gu, "_")
    .slice(0, 180) || "attachment.pdf";
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function parseAttachmentRange(
  header: string | undefined,
  sizeBytes: number,
): AttachmentByteRange | undefined {
  if (!header) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) {
    throw new AttachmentRangeError(sizeBytes);
  }
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) {
      throw new AttachmentRangeError(sizeBytes);
    }
    return { start: Math.max(0, sizeBytes - suffix), end: sizeBytes - 1 };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] === "" ? sizeBytes - 1 : Number(match[2]);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= sizeBytes ||
    requestedEnd < start
  ) {
    throw new AttachmentRangeError(sizeBytes);
  }
  return { start, end: Math.min(requestedEnd, sizeBytes - 1) };
}
