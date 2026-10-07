import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { load } from "js-yaml";

const patchedVersion = "1.2.2";
const overrideKey = "postcss>source-map-js";
const workspace = load(readFileSync(new URL("../../pnpm-workspace.yaml", import.meta.url), "utf8"));
const lockfile = load(readFileSync(new URL("../../pnpm-lock.yaml", import.meta.url), "utf8"));

function assertPatchedResolution(configuration, locked) {
  assert.equal(configuration.overrides?.[overrideKey], patchedVersion);
  assert.equal(locked.overrides?.[overrideKey], patchedVersion);
  const packages = Object.keys(locked.packages ?? {}).filter((key) => key.startsWith("source-map-js@"));
  assert.deepEqual(packages, [`source-map-js@${patchedVersion}`]);
  const snapshots = Object.keys(locked.snapshots ?? {}).filter((key) => key.startsWith("source-map-js@"));
  assert.deepEqual(snapshots, [`source-map-js@${patchedVersion}`]);
  const consumers = Object.entries(locked.snapshots ?? {}).filter(([key]) => key.startsWith("postcss@"));
  assert.ok(consumers.length > 0, "PostCSS consumers must be checked");
  for (const [key, value] of consumers) {
    assert.equal(value.dependencies?.["source-map-js"], patchedVersion, `${key} resolved a different source-map-js`);
  }
}

test("PostCSS resolves only the upstream source-map-js security patch", () => {
  assertPatchedResolution(workspace, lockfile);
});

test("dependency policy rejects a vulnerable package or consumer resolution", () => {
  const oldPackage = structuredClone(lockfile);
  oldPackage.packages["source-map-js@1.2.1"] = {};
  assert.throws(() => assertPatchedResolution(workspace, oldPackage));

  const oldConsumer = structuredClone(lockfile);
  const consumer = Object.keys(oldConsumer.snapshots).find((key) => key.startsWith("postcss@"));
  oldConsumer.snapshots[consumer].dependencies["source-map-js"] = "1.2.1";
  assert.throws(() => assertPatchedResolution(workspace, oldConsumer));

  const missingPin = structuredClone(workspace);
  delete missingPin.overrides[overrideKey];
  assert.throws(() => assertPatchedResolution(missingPin, lockfile));
});

test("source-map-js patch does not exempt audit or release-age safeguards", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(workflow, /pnpm audit --prod --audit-level high/u);
  assert.ok((workspace.minimumReleaseAgeExclude ?? []).every((name) => !name.includes("source-map-js")));
});

function assertPortfolioSecurityPatches(configuration, locked) {
  for (const [name, version] of [["sharp", "0.35.5"], ["@fastify/busboy", "3.2.2"]]) {
    assert.equal(configuration.overrides?.[name], version);
    assert.equal(locked.overrides?.[name], version);
    assert.deepEqual(Object.keys(locked.packages ?? {}).filter(key => key.startsWith(`${name}@`)), [`${name}@${version}`]);
    assert.ok((configuration.minimumReleaseAgeExclude ?? []).every(value => !value.includes(name)));
  }
  const nextConsumers = Object.entries(locked.snapshots).filter(([name]) => name.startsWith("next@"));
  const multipartConsumers = Object.entries(locked.snapshots).filter(([name]) => name.startsWith("@fastify/multipart@"));
  assert.ok(nextConsumers.length && multipartConsumers.length);
  for (const [, value] of nextConsumers) assert.equal(value.optionalDependencies?.sharp?.split("(")[0], "0.35.5");
  for (const [, value] of multipartConsumers) assert.equal(value.dependencies?.["@fastify/busboy"], "3.2.2");
}

test("portfolio image and multipart consumers resolve upstream security patches", () => {
  assertPortfolioSecurityPatches(workspace, lockfile);
});

test("portfolio patch guard rejects old consumer resolutions", () => {
  const oldConsumer = structuredClone(lockfile);
  const consumer = Object.keys(oldConsumer.snapshots).find(key => key.startsWith("next@"));
  oldConsumer.snapshots[consumer].optionalDependencies.sharp = "0.35.4";
  assert.throws(() => assertPortfolioSecurityPatches(workspace, oldConsumer));
});
