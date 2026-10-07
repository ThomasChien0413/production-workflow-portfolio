/**
 * Vendor Noto Sans TC into the repository.
 *
 * `next/font/google` downloads the family during `next build`, which makes the
 * production image unbuildable whenever the runner cannot reach Google — twice
 * in one day on this project's CI, once in `pnpm build:web` and once inside the
 * Docker build. It also means every operator's browser fetches fonts from a
 * third party, which a factory intranet may not permit and which nobody needs
 * to know about the people using this system.
 *
 * So the font is committed. Google slices Noto Sans TC into ~105 files by
 * `unicode-range`, and because the upstream file is a variable font each slice
 * serves 400, 500 and 700 alike — a browser downloads only the ranges the page
 * actually uses, which is what makes a CJK webfont affordable at all.
 *
 * Run this only to adopt a new upstream version, and commit what it produces:
 *   node scripts/fonts/vendor-noto-sans-tc.mjs
 *
 * It rewrites both the files and the stylesheet, so the two can never drift.
 */
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fontDir = join(root, "apps", "web", "public", "fonts", "noto-sans-tc");
const cssPath = join(root, "apps", "web", "src", "app", "fonts.css");

// DESIGN.md §3.2.2: 400/500/700 only. `display=swap` keeps text readable
// against the system fallbacks while a slice is in flight.
const SOURCE =
  "https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&display=swap";
// Google serves woff2 only to a user agent it believes supports it.
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function fetchText(url) {
  const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  return response.text();
}

const upstream = await fetchText(SOURCE);

/**
 * Most slices arrive as `.../<hash>.<index>.woff2` and the index is stable, so
 * it makes the clearest local name. A few — the Latin ranges — carry no index
 * at all, and those fall back to their upstream basename so the mapping stays
 * one-to-one and reproducible.
 */
function localName(url) {
  const indexed = /\.(\d+)\.woff2$/.exec(url);
  if (indexed) return `noto-sans-tc-${indexed[1].padStart(3, "0")}.woff2`;
  const basename = url.slice(url.lastIndexOf("/") + 1).replace(/\.woff2$/, "");
  return `noto-sans-tc-${basename.slice(-12)}.woff2`;
}

const urls = [...new Set(upstream.match(/https:\/\/[^)'"]+\.woff2/g) ?? [])];
if (urls.length === 0) throw new Error("no font files found in the upstream CSS");

const version = /\/notosanstc\/(v\d+)\//.exec(urls[0])?.[1] ?? "unknown";

await rm(fontDir, { recursive: true, force: true });
await mkdir(fontDir, { recursive: true });

let bytes = 0;
for (const url of urls) {
  const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  const body = Buffer.from(await response.arrayBuffer());
  bytes += body.byteLength;
  await writeFile(join(fontDir, localName(url)), body);
}

const css = upstream
  .replace(/https:\/\/[^)'"]+\.woff2/g, (url) => `/fonts/noto-sans-tc/${localName(url)}`)
  .trim();

await writeFile(
  cssPath,
  `/*
 * Noto Sans TC, ${version}, vendored from Google Fonts.
 *
 * GENERATED — do not edit. Run scripts/fonts/vendor-noto-sans-tc.mjs and
 * commit the result. Editing this by hand will be silently overwritten, and
 * the URLs here must match the files in public/fonts/noto-sans-tc.
 *
 * Sliced by unicode-range: a browser downloads only the ranges a page uses,
 * and because the upstream file is a variable font one slice serves all three
 * weights. See DESIGN.md §3.2.2.
 */
${css}
`,
  "utf8",
);

const written = (await readdir(fontDir)).length;
console.log(
  `Noto Sans TC ${version}: ${written} files, ${(bytes / 1024 / 1024).toFixed(1)} MB`,
);
