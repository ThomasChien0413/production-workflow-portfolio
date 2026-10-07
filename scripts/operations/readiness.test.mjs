import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { load } from "js-yaml";
import { evaluateLoadSummary, percentile } from "./load-baseline.mjs";
import { libpqEnvironment, restoreArchiveArguments, validateRecoveryTargets } from "./recovery-rehearsal.mjs";
import { positiveInteger, requireLoopbackHttpUrl } from "./target-safety.mjs";
import { isBodyLimitTransportError } from "./security-http-smoke.mjs";

test("portfolio CI is public-only, GitHub-hosted and read-only", () => {
  const contents = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  const workflow = load(contents);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  for (const job of Object.values(workflow.jobs)) {
    assert.ok(["ubuntu-24.04", "windows-latest"].includes(job["runs-on"]));
    assert.equal(job.if, "github.event.repository.private == false");
  }
  assert.doesNotMatch(contents, /pull_request_target|workflow_run|contents: write|actions: write|upload-artifact|self-hosted/u);
  assert.match(contents, /pnpm audit --prod --audit-level high/u);
});

test("readiness HTTP tools reject remote or credentialed targets", () => {
  assert.equal(requireLoopbackHttpUrl("http://127.0.0.1:3001/api/health").hostname, "127.0.0.1");
  assert.throws(() => requireLoopbackHttpUrl("https://portfolio.example/api/health"), /loopback/u);
  assert.throws(() => requireLoopbackHttpUrl("http://user:test@localhost:3001"), /credentials/u);
});

test("readiness numeric inputs and latency summaries enforce their gates", () => {
  assert.equal(positiveInteger("35", "concurrency", { max: 100 }), 35);
  assert.throws(() => positiveInteger("101", "concurrency", { max: 100 }), /between/u);
  assert.equal(percentile([40, 10, 30, 20], 0.95), 40);
  assert.equal(evaluateLoadSummary({ requests: 20, errorRate: 0.1, p95Ms: 900 }, { minimumRequests: 100, maximumErrorRate: 0.01, maximumP95Ms: 750 }).length, 3);
});

test("body-limit smoke accepts only known early-close failures", () => {
  assert.equal(isBodyLimitTransportError({ cause: { code: "EPIPE" } }), true);
  assert.equal(isBodyLimitTransportError(new Error("unknown")), false);
});

test("recovery requires distinct local demo targets and explicit restore arguments", () => {
  const source = "postgres://workflow:test@127.0.0.1:5432/workflow_demo_test";
  const target = "postgres://workflow:test@127.0.0.1:5432/workflow_restore_rehearsal_ci";
  assert.equal(validateRecoveryTargets(source, target).target.databaseName, "workflow_restore_rehearsal_ci");
  assert.throws(() => validateRecoveryTargets(source, source), /different/u);
  assert.throws(() => validateRecoveryTargets(source.replace("127.0.0.1", "remote.example.invalid"), target), /loopback/u);
  assert.deepEqual(restoreArchiveArguments("workflow_restore_rehearsal_ci", "/demo.dump"), ["pg_restore", "--dbname", "workflow_restore_rehearsal_ci", "--exit-on-error", "--no-owner", "--no-acl", "/demo.dump"]);
  const environment = libpqEnvironment(new URL(source));
  assert.equal(environment.PGDATABASE, "workflow_demo_test");
});
