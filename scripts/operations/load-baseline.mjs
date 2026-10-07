import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { positiveInteger, requireLoopbackHttpUrl } from "./target-safety.mjs";

export function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(fraction * ordered.length) - 1)];
}

export function evaluateLoadSummary(summary, thresholds) {
  const failures = [];
  if (summary.requests < thresholds.minimumRequests) {
    failures.push(`request count ${summary.requests} is below ${thresholds.minimumRequests}`);
  }
  if (summary.errorRate > thresholds.maximumErrorRate) {
    failures.push(`error rate ${summary.errorRate} exceeds ${thresholds.maximumErrorRate}`);
  }
  if (summary.p95Ms > thresholds.maximumP95Ms) {
    failures.push(`p95 ${summary.p95Ms} ms exceeds ${thresholds.maximumP95Ms} ms`);
  }
  return failures;
}

export async function runLoadBaseline({
  target,
  concurrency = 35,
  durationSeconds = 10,
  requestTimeoutMs = 2_000,
}) {
  const url = requireLoopbackHttpUrl(target, "load target");
  if (url.pathname !== "/api/health" || url.search || url.hash) {
    throw new Error("load target must be the loopback /api/health endpoint without query or fragment");
  }

  const probe = await fetch(url, { signal: AbortSignal.timeout(requestTimeoutMs) });
  if (!probe.ok || (await probe.json()).status !== "ok") {
    throw new Error("load target did not pass the health probe");
  }

  const latencies = [];
  let requests = 0;
  let errors = 0;
  const startedAt = performance.now();
  const deadline = startedAt + durationSeconds * 1_000;

  async function worker() {
    while (performance.now() < deadline) {
      const requestStartedAt = performance.now();
      try {
        const response = await fetch(url, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(requestTimeoutMs),
        });
        if (!response.ok) errors += 1;
        await response.arrayBuffer();
      } catch {
        errors += 1;
      } finally {
        requests += 1;
        latencies.push(performance.now() - requestStartedAt);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const elapsedSeconds = (performance.now() - startedAt) / 1_000;
  return {
    kind: "loopback-health-load-baseline",
    concurrency,
    durationSeconds: Number(elapsedSeconds.toFixed(3)),
    requests,
    errors,
    errorRate: Number((requests === 0 ? 1 : errors / requests).toFixed(6)),
    requestsPerSecond: Number((requests / elapsedSeconds).toFixed(2)),
    p50Ms: Number(percentile(latencies, 0.5).toFixed(2)),
    p95Ms: Number(percentile(latencies, 0.95).toFixed(2)),
    p99Ms: Number(percentile(latencies, 0.99).toFixed(2)),
  };
}

async function main() {
  const target = process.env.LOAD_TARGET ?? "http://127.0.0.1:3001/api/health";
  const concurrency = positiveInteger(process.env.LOAD_CONCURRENCY ?? "35", "LOAD_CONCURRENCY", { max: 100 });
  const durationSeconds = positiveInteger(process.env.LOAD_DURATION_SECONDS ?? "10", "LOAD_DURATION_SECONDS", { max: 120 });
  const maximumP95Ms = positiveInteger(process.env.LOAD_MAX_P95_MS ?? "750", "LOAD_MAX_P95_MS", { max: 60_000 });
  const minimumRequests = positiveInteger(process.env.LOAD_MIN_REQUESTS ?? String(concurrency * 10), "LOAD_MIN_REQUESTS");
  const maximumErrorRate = Number(process.env.LOAD_MAX_ERROR_RATE ?? "0.005");
  if (!Number.isFinite(maximumErrorRate) || maximumErrorRate < 0 || maximumErrorRate > 1) {
    throw new Error("LOAD_MAX_ERROR_RATE must be between 0 and 1");
  }

  const summary = await runLoadBaseline({ target, concurrency, durationSeconds });
  const failures = evaluateLoadSummary(summary, { minimumRequests, maximumErrorRate, maximumP95Ms });
  const result = { ...summary, thresholds: { minimumRequests, maximumErrorRate, maximumP95Ms }, passed: failures.length === 0, failures };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (process.env.READINESS_REPORT_DIR) {
    const file = `${process.env.READINESS_REPORT_DIR}/load-baseline.json`;
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  }
  if (failures.length > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
