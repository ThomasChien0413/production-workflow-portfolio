import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Runs inside the container as its configured user, without overriding CMD or
// WORKDIR. /healthz is independent of the API/database: no secrets are needed.
export const probe = `
if (process.getuid() === 0) throw new Error('Web image must run non-root');
if (process.cwd() !== '/app/apps/web') throw new Error('Wrong web working directory');
const { accessSync, constants } = require('node:fs');
let rootWritable = false;
try { accessSync('/app', constants.W_OK); rootWritable = true; } catch {}
if (rootWritable) throw new Error('/app must remain root-owned and non-writable');
const check = async () => {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch('http://127.0.0.1:3000/healthz', { signal: AbortSignal.timeout(1000) });
      const body = await response.json();
      if (response.status === 200 && body.status === 'ok' && body.service === 'workflow-web') return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Web default command did not become healthy');
};
check().catch(error => { console.error(error.message); process.exitCode = 1; });
`;

function docker(args) {
  const result = spawnSync("docker", args, { encoding: "utf8", timeout: 95_000, maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`Container smoke command failed: ${result.error?.message ?? result.stderr.trim()}`);
  }
  return (args[0] === "logs" ? result.stdout + result.stderr : result.stdout).trim();
}

export function smokeWebContainer(image, runDocker = docker) {
  if (typeof image !== "string" || !/^[a-z0-9][a-z0-9./:_-]*$/u.test(image)) {
    throw new Error("Supply one already-built web image reference");
  }
  const id = runDocker([
    "run", "--detach", "--pull", "never", "--init", "--network", "none",
    "--security-opt", "no-new-privileges:true", image,
  ]);
  if (!/^[0-9a-f]{64}$/u.test(id)) throw new Error("Docker returned an invalid container ID");
  try {
    runDocker(["exec", id, "node", "-e", probe]);
  } catch (error) {
    // This container has no credentials or production data. Preserve its
    // startup diagnostics before removing precisely the container we created.
    let logs = "";
    try { logs = runDocker(["logs", "--tail", "40", id]); } catch {}
    throw new Error(`${error.message}${logs ? `\n${logs}` : ""}`);
  } finally {
    runDocker(["rm", "--force", id]);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error("Usage: node web-container-smoke.mjs <built-image>");
    smokeWebContainer(process.argv[2]);
    console.log("Web container default-command, non-root health check passed");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
