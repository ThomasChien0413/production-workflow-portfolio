import { describe, expect, it } from "vitest";
import { pdfContentDisposition, pdfFilename } from "./pdf.js";

describe("sheet PDF response metadata", () => {
  it("uses the Taipei calendar date and sanitizes unsafe filename characters", () => {
    expect(
      pdfFilename(
        '分條/申請單:*?"<>|',
        "12345678-1234-1234-1234-123456789abc",
        new Date("2026-08-10T16:30:00.000Z"),
      ),
    ).toBe("分條_申請單________20260811_12345678.pdf");
  });

  it("provides an ASCII fallback and an RFC 5987 UTF-8 filename", () => {
    const disposition = pdfContentDisposition(
      "分條申請單_20260811_12345678.pdf",
      "12345678-1234-1234-1234-123456789abc",
    );
    expect(disposition).toContain('filename="sheet-12345678.pdf"');
    expect(disposition).toContain("filename*=UTF-8''%E5%88%86%E6%A2%9D");
  });
});
