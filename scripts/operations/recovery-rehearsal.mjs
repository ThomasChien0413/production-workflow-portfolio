import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

function parsePostgresUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute PostgreSQL URL`);
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error(`${label} must use PostgreSQL`);
  }
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//u, ""));
  if (!databaseName) throw new Error(`${label} must name a database`);
  return { url, databaseName };
}

export function validateRecoveryTargets(sourceValue, targetValue) {
  const source = parsePostgresUrl(sourceValue, "source database");
  const target = parsePostgresUrl(targetValue, "restore database");
  const identity = ({ url, databaseName }) => `${url.hostname.toLowerCase()}:${url.port || "5432"}/${databaseName}`;
  if (identity(source) === identity(target)) {
    throw new Error("restore database must be different from the source database");
  }
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(source.url.hostname.toLowerCase())) {
    throw new Error("source database must be loopback; RDS recovery uses the separately approved runbook");
  }
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(target.url.hostname.toLowerCase())) {
    throw new Error("restore database must be loopback; RDS recovery uses the separately approved runbook");
  }
  if (!/^workflow_restore_rehearsal(?:_[a-z0-9_]+)?$/u.test(target.databaseName)) {
    throw new Error("restore database name must begin with workflow_restore_rehearsal");
  }
  return { source, target };
}

export function libpqEnvironment(url) {
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//u, ""));
  const environment = {
    PGHOST: "host.docker.internal",
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: databaseName,
  };
  const sslMode = url.searchParams.get("sslmode");
  return sslMode ? { ...environment, PGSSLMODE: sslMode } : environment;
}

export function restoreArchiveArguments(databaseName, archivePath) {
  return [
    "pg_restore",
    "--dbname",
    databaseName,
    "--exit-on-error",
    "--no-owner",
    "--no-acl",
    archivePath,
  ];
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${command} failed with exit code ${result.status}`);
  }
  return result.stdout?.trim() ?? "";
}

function dockerPostgres(image, databaseUrl, command, mountDirectory = null) {
  const connectionEnvironment = libpqEnvironment(databaseUrl);
  const args = [
    "run",
    "--rm",
    "--add-host",
    "host.docker.internal:host-gateway",
  ];
  for (const key of Object.keys(connectionEnvironment)) args.push("-e", key);
  if (mountDirectory) args.push("-v", `${resolve(mountDirectory)}:/rehearsal`);
  args.push(image, ...command);
  return run("docker", args, {
    env: { ...process.env, ...connectionEnvironment },
  });
}

export async function runRecoveryRehearsal({ sourceDatabaseUrl, restoreDatabaseUrl, image = "postgres:17-alpine" }) {
  if (!/^postgres:17(?:\.\d+)?-alpine$/u.test(image)) {
    throw new Error("POSTGRES_CLIENT_IMAGE must be a PostgreSQL 17 Alpine image");
  }
  const { source, target } = validateRecoveryTargets(sourceDatabaseUrl, restoreDatabaseUrl);
  const adminUrl = new URL(target.url);
  adminUrl.pathname = "/postgres";
  const escapedDatabaseName = target.databaseName.replaceAll("'", "''");
  const exists = dockerPostgres(
    image,
    adminUrl,
    ["psql", "--no-psqlrc", "-Atqc", `select 1 from pg_database where datname = '${escapedDatabaseName}'`],
  );
  if (exists === "") {
    dockerPostgres(image, adminUrl, ["psql", "--no-psqlrc", "-v", "ON_ERROR_STOP=1", "-c", `create database "${target.databaseName}"`]);
  }

  const tableCount = dockerPostgres(
    image,
    target.url,
    ["psql", "--no-psqlrc", "-Atqc", "select count(*) from pg_catalog.pg_tables where schemaname not in ('pg_catalog', 'information_schema')"],
  );
  if (tableCount !== "0") {
    throw new Error("restore database is not empty; the rehearsal will not overwrite it");
  }

  const workingDirectory = await mkdtemp(join(tmpdir(), "workflow-recovery-"));
  const startedAt = Date.now();
  try {
    dockerPostgres(
      image,
      source.url,
      ["pg_dump", "--format=custom", "--no-owner", "--no-acl", "--file=/rehearsal/workflow-rehearsal.dump"],
      workingDirectory,
    );
    dockerPostgres(image, source.url, ["pg_restore", "--list", "/rehearsal/workflow-rehearsal.dump"], workingDirectory);
    dockerPostgres(
      image,
      target.url,
      restoreArchiveArguments(target.databaseName, "/rehearsal/workflow-rehearsal.dump"),
      workingDirectory,
    );

    const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    run(packageManager, ["db:verify-runtime"], {
      env: { ...process.env, DATABASE_URL: restoreDatabaseUrl },
      stdio: "inherit",
    });

    return {
      kind: "isolated-logical-backup-restore-rehearsal",
      passed: true,
      postgresClientImage: image,
      restoreDatabaseName: target.databaseName,
      durationSeconds: Number(((Date.now() - startedAt) / 1_000).toFixed(3)),
      dumpRemoved: true,
    };
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
}

async function main() {
  const sourceDatabaseUrl = process.env.SOURCE_DATABASE_URL;
  const restoreDatabaseUrl = process.env.RESTORE_DATABASE_URL;
  if (!sourceDatabaseUrl || !restoreDatabaseUrl) {
    throw new Error("SOURCE_DATABASE_URL and RESTORE_DATABASE_URL are required");
  }
  const result = await runRecoveryRehearsal({
    sourceDatabaseUrl,
    restoreDatabaseUrl,
    image: process.env.POSTGRES_CLIENT_IMAGE ?? "postgres:17-alpine",
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (process.env.READINESS_REPORT_DIR) {
    const file = `${process.env.READINESS_REPORT_DIR}/recovery-rehearsal.json`;
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
