import { describe, expect, it } from "vitest";
import { SHEET_ATTACHMENT_MAX_UPLOAD_BYTES } from "./attachments.js";
import { sheetAttachmentMetadataSchema } from "./sheets.js";

describe("PDF attachment upload margin", () => {
  it("leaves a decimal 5 MB margin, rather than using MiB", () => {
    expect(SHEET_ATTACHMENT_MAX_UPLOAD_BYTES).toBe(95_000_000);
    expect(100_000_000 - SHEET_ATTACHMENT_MAX_UPLOAD_BYTES).toBe(5_000_000);
  });

  it("still accepts legacy stored metadata above the new upload cap", () => {
    expect(sheetAttachmentMetadataSchema.parse({
      id: "00000000-0000-4000-8000-000000000001",
      filename: "legacy.pdf",
      sizeBytes: 104_857_600,
      uploader: { id: "00000000-0000-4000-8000-000000000002", displayName: "測試" },
      uploadedAt: "2026-10-05T00:00:00Z",
    }).sizeBytes).toBe(104_857_600);
  });
});
