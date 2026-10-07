import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { requireLoopbackHttpUrl } from "./target-safety.mjs";

export function isBodyLimitTransportError(error) {
  const code = error && typeof error === "object" && "cause" in error &&
    error.cause && typeof error.cause === "object" && "code" in error.cause
    ? error.cause.code
    : null;
  return ["EPIPE", "ECONNRESET", "UND_ERR_SOCKET"].includes(code);
}

export async function runSecurityHttpSmoke(target) {
  const origin = requireLoopbackHttpUrl(target, "security target");
  if (origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("security target must be a loopback origin without a path, query, or fragment");
  }
  const checks = [];
  const check = (name, assertion) => {
    assertion();
    checks.push(name);
  };

  const health = await fetch(new URL("/api/health", origin));
  check("health endpoint is available", () => assert.equal(health.status, 200));
  check("MIME sniffing is disabled", () => assert.equal(health.headers.get("x-content-type-options"), "nosniff"));
  check("framing is denied by the API", () => assert.equal(health.headers.get("x-frame-options"), "SAMEORIGIN"));
  check("referrer policy is restrictive", () => assert.equal(health.headers.get("referrer-policy"), "no-referrer"));
  check("technology header is absent", () => assert.equal(health.headers.get("x-powered-by"), null));

  const allowedOrigin = origin.origin;
  const allowedPreflight = await fetch(new URL("/api/auth/login", origin), {
    method: "OPTIONS",
    headers: { origin: allowedOrigin, "access-control-request-method": "POST" },
  });
  check("configured origin receives CORS permission", () => assert.equal(allowedPreflight.headers.get("access-control-allow-origin"), allowedOrigin));

  const foreignOrigin = "https://attacker.invalid";
  const foreignPreflight = await fetch(new URL("/api/auth/login", origin), {
    method: "OPTIONS",
    headers: { origin: foreignOrigin, "access-control-request-method": "POST" },
  });
  check("foreign origin is never echoed as permitted", () => assert.notEqual(foreignPreflight.headers.get("access-control-allow-origin"), foreignOrigin));

  const crossOriginMutation = await fetch(new URL("/api/auth/login", origin), {
    method: "POST",
    headers: { "content-type": "application/json", origin: foreignOrigin },
    body: JSON.stringify({ username: "nobody", password: "not-a-password" }),
  });
  check("foreign unsafe request is rejected before authentication", () => assert.equal(crossOriginMutation.status, 403));

  const anonymousSession = await fetch(new URL("/api/auth/session", origin));
  check("protected endpoint rejects an anonymous request", () => assert.equal(anonymousSession.status, 401));

  const malformedJson = await fetch(new URL("/api/auth/login", origin), {
    method: "POST",
    headers: { "content-type": "application/json", origin: allowedOrigin },
    body: "{",
  });
  const malformedBody = await malformedJson.text();
  check("malformed JSON is rejected without a stack trace", () => {
    assert.equal(malformedJson.status, 400);
    assert.doesNotMatch(malformedBody, /(?:node_modules|\bat\s+\S+\s+\()/u);
  });

  let oversizedRequestRejected = false;
  try {
    const oversizedJson = await fetch(new URL("/api/auth/login", origin), {
      method: "POST",
      headers: { "content-type": "application/json", origin: allowedOrigin },
      body: JSON.stringify({ username: "x".repeat(1_100_000), password: "x" }),
    });
    oversizedRequestRejected = oversizedJson.status === 413;
  } catch (error) {
    // Fastify may close the upload as soon as the limit is crossed. Undici then
    // reports a broken/reset socket instead of receiving the 413 response.
    oversizedRequestRejected = isBodyLimitTransportError(error);
  }
  check("oversized request body is rejected", () => assert.equal(oversizedRequestRejected, true));

  return { kind: "loopback-http-security-smoke", passed: true, checks };
}

async function main() {
  const result = await runSecurityHttpSmoke(process.env.SECURITY_TARGET ?? "http://127.0.0.1:3001");
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (process.env.READINESS_REPORT_DIR) {
    const file = `${process.env.READINESS_REPORT_DIR}/security-http-smoke.json`;
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
