import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  parseEnvironmentFile,
  validateProductionEnvironment,
} from "./validate-production-env.mjs";

const valid = {
  AWS_REGION: "ap-northeast-1",
  ECR_REGISTRY: "123456789012.dkr.ecr.ap-northeast-1.amazonaws.com",
  IMAGE_TAG: "a".repeat(40),
  ACME_EMAIL: "ops@example.com",
  NODE_ENV: "production",
  APP_ORIGIN: "https://portfolio.example",
  API_ORIGIN: "http://api:3001",
  API_HOST: "0.0.0.0",
  API_PORT: "3001",
  DATABASE_URL: "postgresql://app:secret@private.ap-northeast-1.rds.amazonaws.com:5432/workflow?sslmode=require",
  SESSION_COOKIE_NAME: "workflow_session",
  WEB_PUSH_VAPID_PUBLIC_KEY: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U",
  WEB_PUSH_VAPID_PRIVATE_KEY: "vapid-private-key",
  WEB_PUSH_SUBJECT: "mailto:admin@portfolio.example",
  ATTACHMENT_STORAGE_DRIVER: "s3",
  ATTACHMENT_S3_BUCKET: "workflow-production-attachments-123456789012",
  ATTACHMENT_S3_PREFIX: "attachments",
  ATTACHMENT_MAX_BYTES: "95000000",
  ATTACHMENT_UPLOAD_CONCURRENCY: "2",
  ATTACHMENT_DELETE_RETRY_BASE_MS: "30000",
  ATTACHMENT_DELETE_RETRY_MAX_MS: "1800000",
};

test("parses comments, quotes, and values containing equals signs", () => {
  assert.deepEqual(parseEnvironmentFile("# comment\nA=one=two\nB='three'\n"), {
    A: "one=two",
    B: "three",
  });
});

test("accepts a production-safe environment shape", () => {
  assert.deepEqual(validateProductionEnvironment(valid), []);
});

test("rejects mutable images, non-TLS databases, local origins, and static AWS credentials", () => {
  const errors = validateProductionEnvironment({
    ...valid,
    IMAGE_TAG: "latest",
    APP_ORIGIN: "http://localhost:3000",
    DATABASE_URL: "postgresql://app:secret@localhost:5432/workflow",
    AWS_ACCESS_KEY_ID: "must-not-be-here",
    ATTACHMENT_STORAGE_DRIVER: "filesystem",
    ATTACHMENT_MAX_BYTES: "209715200",
    WEB_PUSH_VAPID_PUBLIC_KEY: "not-a-key",
    WEB_PUSH_SUBJECT: "admin@portfolio.example",
  });
  assert.ok(errors.some((error) => error.includes("IMAGE_TAG")));
  assert.ok(errors.some((error) => error.includes("APP_ORIGIN")));
  assert.ok(errors.some((error) => error.includes("local or Compose")));
  assert.ok(errors.some((error) => error.includes("private RDS")));
  assert.ok(errors.some((error) => error.includes("PostgreSQL TLS")));
  assert.ok(errors.some((error) => error.includes("AWS_ACCESS_KEY_ID")));
  assert.ok(errors.some((error) => error.includes("ATTACHMENT_STORAGE_DRIVER")));
  assert.ok(errors.some((error) => error.includes("95 MB")));
  assert.ok(errors.some((error) => error.includes("WEB_PUSH_VAPID_PUBLIC_KEY")));
  assert.ok(errors.some((error) => error.includes("WEB_PUSH_SUBJECT")));
});

test("rejects the example attachment bucket outside placeholder validation", () => {
  const errors = validateProductionEnvironment({
    ...valid,
    ATTACHMENT_S3_BUCKET: "workflow-production-attachments-000000000000",
  });
  assert.ok(errors.some((error) => error.includes("ATTACHMENT_S3_BUCKET")));
});

test("rejects the legacy cap and MiB conversions that erase the upload margin", () => {
  for (const value of ["104857600", "100000000", "99614720", "95000001"]) {
    assert.ok(validateProductionEnvironment({ ...valid, ATTACHMENT_MAX_BYTES: value })
      .some((error) => error.includes("95 MB")));
  }
});

test("shared upload cap, environment examples and Compose stay aligned", async () => {
  const source = await readFile(new URL("../../packages/contracts/src/attachments.ts", import.meta.url), "utf8");
  const cap = Number(source.match(/SHEET_ATTACHMENT_MAX_UPLOAD_BYTES = ([\d_]+)/u)?.[1].replaceAll("_", ""));
  assert.equal(String(cap), valid.ATTACHMENT_MAX_BYTES);
  for (const path of ["../../.env.example", "../../deploy/production.env.example"]) {
    const example = parseEnvironmentFile(await readFile(new URL(path, import.meta.url), "utf8"));
    assert.equal(example.ATTACHMENT_MAX_BYTES, String(cap));
  }
  const compose = await readFile(new URL("../../compose.production.yaml", import.meta.url), "utf8");
  assert.ok(compose.includes(`ATTACHMENT_MAX_BYTES: \u0024{ATTACHMENT_MAX_BYTES:-${cap}}`));
});
