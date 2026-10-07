import "./load-env.js";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  FileAttachmentStorage,
  S3AttachmentStorage,
} from "@workflow/attachment-storage";
import { createDatabase, sheetAttachments } from "@workflow/database";
import { reconcileAvailableAttachments } from "./attachment-reconciliation.js";

const optionalNonEmpty = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

const config = z.object({
  DATABASE_URL: z.string().min(1),
  AWS_REGION: optionalNonEmpty,
  ATTACHMENT_STORAGE_DRIVER: z.enum(["filesystem", "s3"]).default("filesystem"),
  ATTACHMENT_LOCAL_DIRECTORY: z.string().min(1).default(".local/attachments"),
  ATTACHMENT_S3_BUCKET: optionalNonEmpty,
}).superRefine((value, context) => {
  if (value.ATTACHMENT_STORAGE_DRIVER === "s3" && !value.ATTACHMENT_S3_BUCKET) {
    context.addIssue({ code: "custom", path: ["ATTACHMENT_S3_BUCKET"], message: "required for S3" });
  }
  if (value.ATTACHMENT_STORAGE_DRIVER === "s3" && !value.AWS_REGION) {
    context.addIssue({ code: "custom", path: ["AWS_REGION"], message: "required for S3" });
  }
}).parse(process.env);

const connection = createDatabase(config.DATABASE_URL, 1);
try {
  const storage = config.ATTACHMENT_STORAGE_DRIVER === "s3"
    ? new S3AttachmentStorage(config.AWS_REGION!, config.ATTACHMENT_S3_BUCKET!)
    : new FileAttachmentStorage(resolve(config.ATTACHMENT_LOCAL_DIRECTORY));
  const records = await connection.db
    .select({
      id: sheetAttachments.id,
      storageKey: sheetAttachments.storageKey,
      storageVersionId: sheetAttachments.storageVersionId,
      sizeBytes: sheetAttachments.sizeBytes,
      sha256: sheetAttachments.sha256,
    })
    .from(sheetAttachments)
    .where(eq(sheetAttachments.state, "AVAILABLE"));
  const result = await reconcileAvailableAttachments(records, storage);
  process.stdout.write(`Checked ${result.checked} available attachment objects.\n`);
  for (const issue of result.issues) {
    process.stderr.write(`- ${issue.attachmentId}: ${issue.kind}\n`);
  }
  if (result.issues.length > 0) process.exitCode = 1;
} finally {
  await connection.close();
}
