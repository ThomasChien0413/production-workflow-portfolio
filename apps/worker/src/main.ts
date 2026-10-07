import "./load-env.js";
import { hostname } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { resolve } from "node:path";
import {
  FileAttachmentStorage,
  S3AttachmentStorage,
} from "@workflow/attachment-storage";
import { createDatabase } from "@workflow/database";
import { PostgresWorkerHealthRepository, WorkerHealthReporter } from "./health.js";
import { WebPushClient } from "./push-client.js";
import { SheetRetentionPurger, SheetRetentionRepository } from "./retention.js";
import { OutboxProcessor, PostgresOutboxRepository } from "./outbox.js";
import {
  OverdueReminderProducer,
  PostgresOverdueReminderRepository,
} from "./overdue.js";
import {
  AttachmentCleanupProcessor,
  AttachmentCleanupRepository,
} from "./attachment-cleanup.js";

const optionalNonEmpty = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

const config = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().min(1),
    WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(500).default(5000),
    WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
    WORKER_LOCK_TIMEOUT_MS: z.coerce.number().int().min(30_000).default(300_000),
    WORKER_HEALTH_INTERVAL_MS: z.coerce.number().int().min(10_000).default(60_000),
    SHEET_RETENTION_INTERVAL_MS: z.coerce.number().int().min(60_000).default(3_600_000),
    // Phone and browser push replaced LINE (the user, 2026-10-04). The VAPID
    // key pair signs every push; the subject is how a push service reaches us.
    PUSH_DELIVERY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
    PUSH_DELIVERY_RETRY_BASE_MS: z.coerce.number().int().min(1_000).default(30_000),
    PUSH_DELIVERY_RETRY_MAX_MS: z.coerce.number().int().min(1_000).default(1_800_000),
    WEB_PUSH_VAPID_PUBLIC_KEY: optionalNonEmpty,
    WEB_PUSH_VAPID_PRIVATE_KEY: optionalNonEmpty,
    WEB_PUSH_SUBJECT: z
      .string()
      .trim()
      .regex(/^(mailto:|https:\/\/)/u)
      .default("mailto:admin@portfolio.example"),
    AWS_REGION: optionalNonEmpty,
    ATTACHMENT_STORAGE_DRIVER: z.enum(["filesystem", "s3"]).default("filesystem"),
    ATTACHMENT_LOCAL_DIRECTORY: z.string().min(1).default(".local/attachments"),
    ATTACHMENT_S3_BUCKET: optionalNonEmpty,
    ATTACHMENT_DELETE_RETRY_BASE_MS: z.coerce.number().int().min(1_000).default(30_000),
    ATTACHMENT_DELETE_RETRY_MAX_MS: z.coerce.number().int().min(1_000).default(1_800_000),
  })
  .superRefine((value, context) => {
    if (
      value.PUSH_DELIVERY_RETRY_MAX_MS < value.PUSH_DELIVERY_RETRY_BASE_MS
    ) {
      context.addIssue({
        code: "custom",
        path: ["PUSH_DELIVERY_RETRY_MAX_MS"],
        message: "Retry maximum must be at least the retry base",
      });
    }
    if (
      value.ATTACHMENT_DELETE_RETRY_MAX_MS <
      value.ATTACHMENT_DELETE_RETRY_BASE_MS
    ) {
      context.addIssue({
        code: "custom",
        path: ["ATTACHMENT_DELETE_RETRY_MAX_MS"],
        message: "Attachment retry maximum must be at least the retry base",
      });
    }
    if (value.NODE_ENV === "production" && value.ATTACHMENT_STORAGE_DRIVER !== "s3") {
      context.addIssue({
        code: "custom",
        path: ["ATTACHMENT_STORAGE_DRIVER"],
        message: "Production attachment storage must use S3",
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
        message: "AWS region is required",
      });
    }
    if (Boolean(value.WEB_PUSH_VAPID_PUBLIC_KEY) !== Boolean(value.WEB_PUSH_VAPID_PRIVATE_KEY)) {
      context.addIssue({
        code: "custom",
        path: ["WEB_PUSH_VAPID_PRIVATE_KEY"],
        message: "Both halves of the web push key pair are needed",
      });
    }
    if (value.NODE_ENV === "production" && !value.WEB_PUSH_VAPID_PRIVATE_KEY) {
      context.addIssue({
        code: "custom",
        path: ["WEB_PUSH_VAPID_PRIVATE_KEY"],
        message: "The web push key pair is required in production",
      });
    }
  })
  .parse(process.env);

const connection = createDatabase(config.DATABASE_URL, 2);
const workerId = `${hostname()}:${process.pid}`;
const abortController = new AbortController();
const repository = new PostgresOutboxRepository(connection.db);
const overdueProducer = new OverdueReminderProducer(
  new PostgresOverdueReminderRepository(connection.db),
);
const attachmentStorage =
  config.ATTACHMENT_STORAGE_DRIVER === "s3"
    ? new S3AttachmentStorage(config.AWS_REGION!, config.ATTACHMENT_S3_BUCKET!)
    : new FileAttachmentStorage(resolve(config.ATTACHMENT_LOCAL_DIRECTORY));
const attachmentCleanupRepository = new AttachmentCleanupRepository(connection.db);
const healthReporter = new WorkerHealthReporter(
  new PostgresWorkerHealthRepository(connection.db),
  config.WORKER_HEALTH_INTERVAL_MS,
);
const retentionPurger = new SheetRetentionPurger(
  new SheetRetentionRepository(connection.db),
  config.SHEET_RETENTION_INTERVAL_MS,
  100,
);
const attachmentCleanupProcessor = new AttachmentCleanupProcessor(
  attachmentCleanupRepository,
  attachmentStorage,
  config.ATTACHMENT_DELETE_RETRY_BASE_MS,
  config.ATTACHMENT_DELETE_RETRY_MAX_MS,
);
const processor =
  config.WEB_PUSH_VAPID_PUBLIC_KEY && config.WEB_PUSH_VAPID_PRIVATE_KEY
    ? new OutboxProcessor(
        repository,
        new WebPushClient({
          publicKey: config.WEB_PUSH_VAPID_PUBLIC_KEY,
          privateKey: config.WEB_PUSH_VAPID_PRIVATE_KEY,
          subject: config.WEB_PUSH_SUBJECT,
        }),
        {
          maxAttempts: config.PUSH_DELIVERY_MAX_ATTEMPTS,
          retryBaseMs: config.PUSH_DELIVERY_RETRY_BASE_MS,
          retryMaxMs: config.PUSH_DELIVERY_RETRY_MAX_MS,
        },
      )
    : null;

async function run(): Promise<void> {
  process.stdout.write(`Workflow Portfolio worker ${workerId} started.\n`);
  if (!processor) {
    process.stdout.write(
      "Push delivery is disabled until the web push key pair is configured.\n",
    );
  }

  while (!abortController.signal.aborted) {
    try {
      const overdueRun = await overdueProducer.runIfDue();
      if (overdueRun.status === "SCANNED" && overdueRun.recipientsCreated > 0) {
        process.stdout.write(
          `Created ${overdueRun.recipientsCreated} overdue reminder recipient records for ${overdueRun.dateKey}.\n`,
        );
      }
      if (processor) {
        const jobs = await repository.claim(
          workerId,
          config.WORKER_BATCH_SIZE,
          config.WORKER_LOCK_TIMEOUT_MS,
        );
        for (const job of jobs) await processor.process(job);
      }
      // Before the cleanup claim, so files it queues go in the same cycle.
      const retentionRun = await retentionPurger.runIfDue();
      if (retentionRun) {
        process.stdout.write(
          `Deleted ${retentionRun} archived sheets a year after 封存.\n`,
        );
      }
      const cleanupJobs = await attachmentCleanupRepository.claim(
        workerId,
        config.WORKER_BATCH_SIZE,
        config.WORKER_LOCK_TIMEOUT_MS,
      );
      for (const job of cleanupJobs) {
        const outcome = await attachmentCleanupProcessor.process(job);
        if (outcome === "RETRYING") {
          process.stderr.write("Attachment cleanup failed; a durable retry was scheduled.\n");
        } else if (outcome === "INVALID") {
          process.stderr.write("Attachment cleanup job was invalid and needs operator review.\n");
        }
      }
      if (!processor && cleanupJobs.length === 0) await connection.client`select 1`;
    } catch (error) {
      const errorName = error instanceof Error ? error.name : "UnknownError";
      process.stderr.write(
        `Worker cycle failed (${errorName}).\n`,
      );
    }

    // Its own failure is not a cycle failure: the work above still ran.
    try {
      await healthReporter.reportIfDue();
    } catch (error) {
      const errorName = error instanceof Error ? error.name : "UnknownError";
      process.stderr.write(`Worker health report failed (${errorName}).\n`);
    }

    try {
      await delay(config.WORKER_POLL_INTERVAL_MS, undefined, {
        signal: abortController.signal,
      });
    } catch {
      // Abort is the expected shutdown path.
    }
  }
}

async function shutdown(signal: string): Promise<void> {
  process.stdout.write(`Worker received ${signal}; shutting down.\n`);
  abortController.abort();
  await connection.close();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await run();
