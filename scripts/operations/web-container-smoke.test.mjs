import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { probe, smokeWebContainer } from "./web-container-smoke.mjs";

const id = "a".repeat(64);

test("web runtime launches Next directly without a writable workspace or runtime package manager", () => {
  const file = readFileSync(new URL("../../docker/web.Dockerfile", import.meta.url), "utf8");
  const runtime = file.split("FROM node:24-alpine AS runtime")[1];
  assert.match(runtime, /USER node\s+WORKDIR \/app\/apps\/web/u);
  assert.match(runtime, /CMD \["node", "node_modules\/next\/dist\/bin\/next", "start", "--port", "3000"\]/u);
  assert.doesNotMatch(runtime, /RUN corepack|CMD \["pnpm"|chmod|chown.*\/app\s/u);
  assert.match(probe, /process\.getuid\(\) === 0/u);
  assert.match(probe, /rootWritable/u);
  assert.match(probe, /response\.status === 200/u);
  assert.match(probe, /body\.service === 'workflow-web'/u);
  const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(ci, /uses: actions\/setup-node@v7\s+with:\s+node-version: 24/u);
  assert.match(ci, /node scripts\/operations\/web-container-smoke\.mjs workflow\/web:ci/u);
});

test("smoke uses the image default command with no network/ports/secrets and cleans its own container", () => {
  const calls = [];
  smokeWebContainer("workflow/web:ci", args => { calls.push(args); return args[0] === "run" ? id : ""; });
  assert.deepEqual(calls[0], ["run", "--detach", "--pull", "never", "--init", "--network", "none", "--security-opt", "no-new-privileges:true", "workflow/web:ci"]);
  assert.deepEqual(calls[1], ["exec", id, "node", "-e", probe]);
  assert.deepEqual(calls[2], ["rm", "--force", id]);
});

test("failed default startup preserves diagnostics, fails the gate and still removes only its container", () => {
  const calls = [];
  assert.throws(() => smokeWebContainer("workflow/web:ci", args => {
    calls.push(args);
    if (args[0] === "run") return id;
    if (args[0] === "exec") throw new Error("unhealthy");
    if (args[0] === "logs") return "EACCES: /app/_tmp_regression";
    return "";
  }), /unhealthy\nEACCES: \/app\/_tmp_regression/u);
  assert.deepEqual(calls.at(-1), ["rm", "--force", id]);
});

test("smoke rejects malformed image/container IDs without issuing a broad cleanup", () => {
  assert.throws(() => smokeWebContainer("--privileged", () => assert.fail()), /image reference/u);
  const calls = [];
  assert.throws(() => smokeWebContainer("workflow/web:ci", args => { calls.push(args); return "invalid"; }), /container ID/u);
  assert.equal(calls.length, 1);
});
