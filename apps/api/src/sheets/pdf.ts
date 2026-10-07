import { chromium, type Browser } from "playwright";
import {
  renderSheetDocumentHtml,
  type RenderSheetHtmlInput,
} from "@workflow/sheet-document";
import { resolveTemplatePrintLayout } from "@workflow/contracts";
import { ServiceUnavailableError } from "../auth/errors.js";

export type PdfRenderInput = RenderSheetHtmlInput & {
  sheetId: string;
  sheetVersion: number;
};

export interface SheetPdfRenderer {
  render(input: PdfRenderInput): Promise<Uint8Array>;
  close(): Promise<void>;
}

const MAX_CONCURRENT_RENDERS = 2;
const RENDER_TIMEOUT_MS = 30_000;

export class PlaywrightSheetPdfRenderer implements SheetPdfRenderer {
  private browserPromise: Promise<Browser> | null = null;
  private activeRenders = 0;

  async render(input: PdfRenderInput): Promise<Uint8Array> {
    if (this.activeRenders >= MAX_CONCURRENT_RENDERS) {
      throw new ServiceUnavailableError("PDF 產生服務忙碌中，請稍後再試。");
    }
    this.activeRenders += 1;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const render = this.renderWithBrowser(input).finally(() => {
        this.activeRenders -= 1;
      });
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new ServiceUnavailableError("PDF 產生逾時，請稍後再試。")),
          RENDER_TIMEOUT_MS,
        );
      });
      return await Promise.race([render, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async close(): Promise<void> {
    const browser = await this.browserPromise?.catch(() => null);
    this.browserPromise = null;
    await browser?.close();
  }

  private browser(): Promise<Browser> {
    this.browserPromise ??= chromium
      .launch({
        headless: true,
        args: ["--disable-dev-shm-usage", "--no-zygote"],
      })
      .catch(() => {
        this.browserPromise = null;
        throw new ServiceUnavailableError("PDF 產生服務暫時無法使用。");
      });
    return this.browserPromise;
  }

  private async renderWithBrowser(input: PdfRenderInput): Promise<Uint8Array> {
    const printLayout = resolveTemplatePrintLayout(input.definition);
    const browser = await this.browser();
    const context = await browser.newContext({ serviceWorkers: "block" });
    try {
      const page = await context.newPage();
      await page.route("**/*", async (route) => {
        const url = route.request().url();
        if (url === "about:blank" || url.startsWith("data:")) await route.continue();
        else await route.abort("blockedbyclient");
      });
      await page.setContent(
        renderSheetDocumentHtml({
          ...input,
          title: `${input.definition.displayName} - ${input.sheetId} - v${input.sheetVersion}`,
        }),
        { waitUntil: "load" },
      );
      await page.evaluate(async () => {
        const browserGlobal = globalThis as unknown as {
          document: { fonts: { ready: Promise<unknown> } };
        };
        await browserGlobal.document.fonts.ready;
      });
      await page.emulateMedia({ media: "print" });
      return await page.pdf({
        format: "A4",
        landscape: printLayout.orientation === "LANDSCAPE",
        margin: {
          top: `${printLayout.marginMm}mm`,
          right: `${printLayout.marginMm}mm`,
          bottom: `${printLayout.marginMm}mm`,
          left: `${printLayout.marginMm}mm`,
        },
        printBackground: true,
        preferCSSPageSize: true,
        tagged: true,
      });
    } finally {
      await context.close();
    }
  }
}

export function pdfFilename(displayName: string, sheetId: string, now: Date): string {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(now)
    .replaceAll("-", "");
  const safeName = displayName
    .normalize("NFC")
    // oxlint-disable-next-line no-control-regex -- control characters are what a filename must not carry.
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "生產單";
  return `${safeName}_${date}_${sheetId.slice(0, 8)}.pdf`;
}

export function pdfContentDisposition(filename: string, sheetId: string): string {
  return `attachment; filename="sheet-${sheetId.slice(0, 8)}.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
