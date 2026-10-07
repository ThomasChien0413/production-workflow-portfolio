import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const requiredKeys = [
  "AWS_REGION",
  "ECR_REGISTRY",
  "IMAGE_TAG",
  "ACME_EMAIL",
  "NODE_ENV",
  "APP_ORIGIN",
  "API_ORIGIN",
  "API_HOST",
  "API_PORT",
  "DATABASE_URL",
  "SESSION_COOKIE_NAME",
  "WEB_PUSH_VAPID_PUBLIC_KEY",
  "WEB_PUSH_VAPID_PRIVATE_KEY",
  "WEB_PUSH_SUBJECT",
  "ATTACHMENT_STORAGE_DRIVER",
  "ATTACHMENT_S3_BUCKET",
  "ATTACHMENT_S3_PREFIX",
  "ATTACHMENT_MAX_BYTES",
  "ATTACHMENT_UPLOAD_CONCURRENCY",
  "ATTACHMENT_DELETE_RETRY_BASE_MS",
  "ATTACHMENT_DELETE_RETRY_MAX_MS",
];

const secretKeys = ["DATABASE_URL", "WEB_PUSH_VAPID_PRIVATE_KEY"];

export function parseEnvironmentFile(source) {
  const values = {};
  for (const [index, rawLine] of source.split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) {
      throw new Error(`Line ${index + 1} is not KEY=VALUE`);
    }
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (!/^[A-Z][A-Z0-9_]*$/u.test(key)) {
      throw new Error(`Line ${index + 1} has an invalid key`);
    }
    if (Object.hasOwn(values, key)) {
      throw new Error(`Line ${index + 1} repeats ${key}`);
    }
    values[key] = value;
  }
  return values;
}

function validUrl(value, protocols) {
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function validateProductionEnvironment(values, allowPlaceholders = false) {
  const errors = [];
  for (const key of requiredKeys) {
    if (!values[key]) errors.push(`${key} is required`);
  }
  if (values.NODE_ENV !== "production") {
    errors.push("NODE_ENV must be production");
  }
  if (values.APP_ORIGIN !== "https://portfolio.example") {
    errors.push("APP_ORIGIN must be https://portfolio.example");
  }
  if (values.API_ORIGIN !== "http://api:3001") {
    errors.push("API_ORIGIN must use the private Compose API origin");
  }
  // Phone and browser push replaced LINE (the user, 2026-10-04).
  if (!/^[A-Za-z0-9_-]{80,100}$/u.test(values.WEB_PUSH_VAPID_PUBLIC_KEY ?? "")) {
    errors.push("WEB_PUSH_VAPID_PUBLIC_KEY must be a base64url VAPID public key (pnpm push:vapid-keys)");
  }
  if (!/^(mailto:|https:\/\/)/u.test(values.WEB_PUSH_SUBJECT ?? "")) {
    errors.push("WEB_PUSH_SUBJECT must be a mailto: or https:// contact for push services");
  }
  if (values.ATTACHMENT_STORAGE_DRIVER !== "s3") {
    errors.push("ATTACHMENT_STORAGE_DRIVER must be s3 in production");
  }
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(values.ATTACHMENT_S3_BUCKET ?? "")) {
    errors.push("ATTACHMENT_S3_BUCKET must be a valid private S3 bucket name");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9!_.*'()-]*(?:\/[A-Za-z0-9][A-Za-z0-9!_.*'()-]*)*$/u.test(values.ATTACHMENT_S3_PREFIX ?? "")) {
    errors.push("ATTACHMENT_S3_PREFIX must be a non-empty object prefix");
  }
  if (values.ATTACHMENT_MAX_BYTES !== "95000000") {
    errors.push("ATTACHMENT_MAX_BYTES must enforce the approved 95 MB cap (95000000 bytes)");
  }
  if (!/^[12]$/u.test(values.ATTACHMENT_UPLOAD_CONCURRENCY ?? "")) {
    errors.push("ATTACHMENT_UPLOAD_CONCURRENCY must be one or two");
  }
  const attachmentRetryBase = Number(values.ATTACHMENT_DELETE_RETRY_BASE_MS);
  const attachmentRetryMax = Number(values.ATTACHMENT_DELETE_RETRY_MAX_MS);
  if (!Number.isSafeInteger(attachmentRetryBase) || attachmentRetryBase < 1_000) {
    errors.push("ATTACHMENT_DELETE_RETRY_BASE_MS must be at least 1000");
  }
  if (
    !Number.isSafeInteger(attachmentRetryMax) ||
    attachmentRetryMax < attachmentRetryBase
  ) {
    errors.push("ATTACHMENT_DELETE_RETRY_MAX_MS must be at least the retry base");
  }
  if (!validUrl(values.DATABASE_URL ?? "", ["postgres:", "postgresql:"])) {
    errors.push("DATABASE_URL must be a PostgreSQL URL");
  } else {
    const databaseUrl = new URL(values.DATABASE_URL);
    if (["localhost", "127.0.0.1", "postgres"].includes(databaseUrl.hostname)) {
      errors.push("DATABASE_URL must not point to a local or Compose database");
    }
    if (
      !databaseUrl.hostname.endsWith(
        `.${values.AWS_REGION ?? "invalid-region"}.rds.amazonaws.com`,
      )
    ) {
      errors.push("DATABASE_URL must point to private RDS in AWS_REGION");
    }
    if (!["require", "verify-full"].includes(databaseUrl.searchParams.get("sslmode"))) {
      errors.push("DATABASE_URL must require PostgreSQL TLS");
    }
  }
  const ecrMatch = /^(\d{12})\.dkr\.ecr\.([a-z0-9-]+)\.amazonaws\.com$/u.exec(
    values.ECR_REGISTRY ?? "",
  );
  if (!ecrMatch) {
    errors.push("ECR_REGISTRY must be a private Amazon ECR registry hostname");
  } else if (ecrMatch[2] !== values.AWS_REGION) {
    errors.push("ECR_REGISTRY region must match AWS_REGION");
  }
  if (!/^[a-f0-9]{40}$/u.test(values.IMAGE_TAG ?? "") && !allowPlaceholders) {
    errors.push("IMAGE_TAG must be an immutable full Git commit SHA");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(values.ACME_EMAIL ?? "")) {
    errors.push("ACME_EMAIL must be a valid email address");
  }
  for (const forbidden of [
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
  ]) {
    if (values[forbidden]) errors.push(`${forbidden} must come from the EC2 instance role`);
  }
  if (!allowPlaceholders) {
    for (const key of [...secretKeys, "ATTACHMENT_S3_BUCKET"]) {
      if (/REPLACE|EXAMPLE|CHANGEME|000000000000/iu.test(values[key] ?? "")) {
        errors.push(`${key} still contains a placeholder`);
      }
    }
  }
  return errors;
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: validate-production-env.mjs <env-file> [--allow-placeholders]");
  const allowPlaceholders = process.argv.includes("--allow-placeholders");
  const values = parseEnvironmentFile(await readFile(file, "utf8"));
  const errors = validateProductionEnvironment(values, allowPlaceholders);
  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`- ${error}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`Production environment shape is valid (${Object.keys(values).length} keys; values not displayed).\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
