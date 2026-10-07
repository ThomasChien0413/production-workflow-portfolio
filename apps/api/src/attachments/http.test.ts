import { describe, expect, it } from "vitest";
import {
  AttachmentRangeError,
  attachmentContentDisposition,
  normalizeAttachmentFilename,
  parseAttachmentRange,
} from "./http.js";

describe("attachment HTTP safety", () => {
  it("normalizes unsafe filenames without losing the PDF extension", () => {
    expect(normalizeAttachmentFilename("../../\u0000 生產  表.pdf")).toBe("生產 表.pdf");
    expect(normalizeAttachmentFilename("C:\\fakepath\\report.PDF")).toBe("report.PDF");
    expect(normalizeAttachmentFilename(" ")).toBe("attachment.pdf");
  });

  it("builds safe ASCII and UTF-8 content disposition values", () => {
    const value = attachmentContentDisposition("attachment", "測試\"附件.pdf");
    expect(value).toContain('attachment; filename="');
    expect(value).not.toContain('測試"');
    expect(value).toContain("filename*=UTF-8''");
  });

  it("truncates Unicode filenames without creating an invalid surrogate", () => {
    const normalized = normalizeAttachmentFilename(`${"😀".repeat(300)}.pdf`);
    expect(Array.from(normalized)).toHaveLength(255);
    expect(normalized.endsWith(".pdf")).toBe(true);
    expect(() => attachmentContentDisposition("attachment", normalized)).not.toThrow();
  });

  it("supports normal, open-ended, and suffix byte ranges", () => {
    expect(parseAttachmentRange("bytes=2-5", 10)).toEqual({ start: 2, end: 5 });
    expect(parseAttachmentRange("bytes=7-", 10)).toEqual({ start: 7, end: 9 });
    expect(parseAttachmentRange("bytes=-3", 10)).toEqual({ start: 7, end: 9 });
    expect(parseAttachmentRange("bytes=8-30", 10)).toEqual({ start: 8, end: 9 });
  });

  it("rejects invalid or multiple ranges with the object size", () => {
    for (const value of ["bytes=10-11", "bytes=4-2", "bytes=0-1,4-5", "items=0-1"]) {
      try {
        parseAttachmentRange(value, 10);
        throw new Error("expected range rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(AttachmentRangeError);
        expect((error as AttachmentRangeError).sizeBytes).toBe(10);
      }
    }
  });
});
