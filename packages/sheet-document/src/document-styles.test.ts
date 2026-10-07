import { expect, it } from "vitest";
import { documentStyles } from "./document-styles.js";

it("keeps a collapsed right-hand border inside the printable box without changing page settings", () => {
  const css = documentStyles({ paperSize: "A4", orientation: "LANDSCAPE", marginMm: 8 });
  expect(css).toContain("@page{size:A4 landscape;margin:8mm}");
  expect(css).toContain(".content{position:relative;z-index:1;padding-right:.35mm}");
  expect(css).toContain(".grid{width:100%;border-collapse:collapse");
});
