import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { relative, join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const ignored = new Set([".git", "node_modules", "dist", ".next", "coverage", "test-results", "playwright-report", ".local", ".readiness"]);
const rules = [
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/u],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
  ["cloud resource identifier", /\barn:aws:[a-z0-9-]+:[a-z0-9-]*:[0-9]{12}:/u],
  ["operator home path", /(?:[A-Z]:[\\/]Users[\\/](?!Public\b)[^\s"']+|\/home\/cloudshell-user\/)/u],
];
const findings = [];
let scanned = 0;
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    const label = relative(root, path).replaceAll("\\", "/");
    if (entry.isSymbolicLink()) { findings.push({ path: label, rule: "unexpected symlink" }); continue; }
    if (entry.isDirectory()) {
      if ([".auth", ".aws", ".claude", ".codex"].includes(entry.name)) findings.push({ path: label, rule: "private state directory" });
      else await walk(path);
      continue;
    }
    if ((entry.name.startsWith(".env") && entry.name !== ".env.example") || /\.(?:dump|sql\.gz|pem|pfx|p12|har|zip)$/iu.test(entry.name)) {
      findings.push({ path: label, rule: "private/environment/archive file" });
      continue;
    }
    // Authorized form images/fonts are reviewed separately, not interpreted as text.
    if (/\.(?:png|jpe?g|webp|woff2?|ttf|otf|pdf)$/iu.test(entry.name)) continue;
    const content = await readFile(path, "utf8");
    scanned++;
    for (const [index, line] of content.split(/\r?\n/u).entries()) {
      for (const [rule, pattern] of rules) {
        if (pattern.test(line)) findings.push({ path: label, line: index + 1, rule });
      }
    }
  }
}
await walk(root);
if (findings.length) {
  console.error(JSON.stringify({ status: "review required", findings }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ status: "selected checks passed", scannedTextFiles: scanned, limitations: "Manual review still required; ignored local/generated files and authorized binary assets are not certified by this scan." }));
}
