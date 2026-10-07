import { z } from "zod";
import { SHEET_ATTACHMENT_MAX_UPLOAD_BYTES } from "@workflow/contracts";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const optionalNonEmptyString = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().min(1).optional(),
);

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.string().min(1),
  APP_ORIGIN: z.string().url().default("http://localhost:3000"),
  SESSION_COOKIE_NAME: z.string().min(1).default("workflow_session"),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  LOGIN_LOCK_THRESHOLD: z.coerce.number().int().min(2).default(5),
  LOGIN_ATTEMPT_WINDOW_MINUTES: z.coerce.number().positive().default(15),
  LOGIN_LOCK_MINUTES: z.coerce.number().positive().default(15),
  // Phone and browser push replaced LINE (the user, 2026-10-04). Browsers
  // need the public half of the server's VAPID key pair to subscribe; the
  // worker holds the private half.
  WEB_PUSH_VAPID_PUBLIC_KEY: optionalNonEmptyString,
  AWS_REGION: optionalNonEmptyString,
  ATTACHMENT_STORAGE_DRIVER: z.enum(["filesystem", "s3"]).default("filesystem"),
  ATTACHMENT_LOCAL_DIRECTORY: z.string().min(1).default(".local/attachments"),
  ATTACHMENT_TEMP_DIRECTORY: z
    .string()
    .min(1)
    .default(resolve(tmpdir(), "workflow-attachment-uploads")),
  ATTACHMENT_S3_BUCKET: optionalNonEmptyString,
  ATTACHMENT_S3_PREFIX: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9!_.*'()-]*(?:\/[A-Za-z0-9][A-Za-z0-9!_.*'()-]*)*$/u)
    .default("attachments"),
  ATTACHMENT_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(SHEET_ATTACHMENT_MAX_UPLOAD_BYTES)
    .default(SHEET_ATTACHMENT_MAX_UPLOAD_BYTES),
  ATTACHMENT_UPLOAD_CONCURRENCY: z.coerce.number().int().min(1).max(2).default(2),
}).superRefine((value, context) => {
  if (value.NODE_ENV === "production" && value.ATTACHMENT_STORAGE_DRIVER !== "s3") {
    context.addIssue({
      code: "custom",
      path: ["ATTACHMENT_STORAGE_DRIVER"],
      message: "Production attachment storage must use S3",
    });
  }
  if (value.NODE_ENV === "production" && !value.WEB_PUSH_VAPID_PUBLIC_KEY) {
    context.addIssue({
      code: "custom",
      path: ["WEB_PUSH_VAPID_PUBLIC_KEY"],
      message: "Production needs the web push public key",
    });
  }
  if (value.ATTACHMENT_STORAGE_DRIVER === "s3" && !value.ATTACHMENT_S3_BUCKET) {
    context.addIssue({
      code: "custom",
      path: ["ATTACHMENT_S3_BUCKET"],
      message: "S3 attachment bucket is required",
    });
  }
  if (value.ATTACHMENT_STORAGE_DRIVER === "s3" && !value.AWS_REGION) {
    context.addIssue({
      code: "custom",
      path: ["AWS_REGION"],
      message: "AWS region is required for S3 attachment storage",
    });
  }
});

export type ApiConfig = {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  databaseUrl: string;
  appOrigin: string;
  sessionCookieName: string;
  csrfCookieName: string;
  sessionTtlMs: number;
  loginLockThreshold: number;
  loginAttemptWindowMs: number;
  loginLockMs: number;
  secureCookies: boolean;
  webPushVapidPublicKey: string | null;
  awsRegion: string | null;
  attachmentStorageDriver: "filesystem" | "s3";
  attachmentLocalDirectory: string;
  attachmentTempDirectory: string;
  attachmentS3Bucket: string | null;
  attachmentS3Prefix: string;
  attachmentMaxBytes: number;
  attachmentUploadConcurrency: number;
};

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = configSchema.parse(environment);

  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.API_HOST,
    port: parsed.API_PORT,
    databaseUrl: parsed.DATABASE_URL,
    appOrigin: parsed.APP_ORIGIN.replace(/\/$/, ""),
    sessionCookieName: parsed.SESSION_COOKIE_NAME,
    csrfCookieName: "workflow_csrf",
    sessionTtlMs: parsed.SESSION_TTL_HOURS * 60 * 60 * 1000,
    loginLockThreshold: parsed.LOGIN_LOCK_THRESHOLD,
    loginAttemptWindowMs: parsed.LOGIN_ATTEMPT_WINDOW_MINUTES * 60 * 1000,
    loginLockMs: parsed.LOGIN_LOCK_MINUTES * 60 * 1000,
    secureCookies: parsed.NODE_ENV === "production",
    webPushVapidPublicKey: parsed.WEB_PUSH_VAPID_PUBLIC_KEY ?? null,
    awsRegion: parsed.AWS_REGION ?? null,
    attachmentStorageDriver: parsed.ATTACHMENT_STORAGE_DRIVER,
    attachmentLocalDirectory: resolve(parsed.ATTACHMENT_LOCAL_DIRECTORY),
    attachmentTempDirectory: resolve(parsed.ATTACHMENT_TEMP_DIRECTORY),
    attachmentS3Bucket: parsed.ATTACHMENT_S3_BUCKET ?? null,
    attachmentS3Prefix: parsed.ATTACHMENT_S3_PREFIX.replace(/^\/+|\/+$/gu, ""),
    attachmentMaxBytes: parsed.ATTACHMENT_MAX_BYTES,
    attachmentUploadConcurrency: parsed.ATTACHMENT_UPLOAD_CONCURRENCY,
  };
}
