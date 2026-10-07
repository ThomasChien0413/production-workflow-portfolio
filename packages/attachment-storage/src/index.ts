import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export type AttachmentByteRange = {
  start: number;
  end: number;
};

export type StoredAttachment = {
  versionId: string | null;
};

export type OpenedAttachment = {
  stream: Readable;
  contentLength: number;
};

export type InspectedAttachment = {
  sizeBytes: number;
  sha256: string | null;
};

export interface AttachmentStorage {
  put(input: {
    key: string;
    sourcePath: string;
    sizeBytes: number;
    sha256: string;
  }): Promise<StoredAttachment>;
  open(input: {
    key: string;
    versionId?: string | null;
    range?: AttachmentByteRange;
  }): Promise<OpenedAttachment>;
  inspect(input: {
    key: string;
    versionId?: string | null;
  }): Promise<InspectedAttachment | null>;
  delete(input: { key: string; versionId?: string | null }): Promise<void>;
}

function assertSafeKey(key: string): void {
  if (
    key.length === 0 ||
    key.startsWith("/") ||
    key.includes("\\") ||
    key.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error("Invalid attachment storage key");
  }
}

function localPath(root: string, key: string): string {
  assertSafeKey(key);
  const normalizedRoot = resolve(root);
  const target = resolve(normalizedRoot, ...key.split("/"));
  if (!target.startsWith(`${normalizedRoot}${sep}`)) {
    throw new Error("Attachment storage key leaves configured root");
  }
  return target;
}

export class FileAttachmentStorage implements AttachmentStorage {
  constructor(private readonly root: string) {}

  async put(input: {
    key: string;
    sourcePath: string;
    sizeBytes: number;
    sha256: string;
  }): Promise<StoredAttachment> {
    const target = localPath(this.root, input.key);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await pipeline(
      createReadStream(input.sourcePath),
      createWriteStream(target, { flags: "wx", mode: 0o600 }),
    );
    return { versionId: null };
  }

  async open(input: {
    key: string;
    versionId?: string | null;
    range?: AttachmentByteRange;
  }): Promise<OpenedAttachment> {
    const target = localPath(this.root, input.key);
    const details = await stat(target);
    const contentLength = input.range
      ? input.range.end - input.range.start + 1
      : details.size;
    return {
      stream: createReadStream(target, input.range),
      contentLength,
    };
  }

  async delete(input: { key: string; versionId?: string | null }): Promise<void> {
    await rm(localPath(this.root, input.key), { force: true });
  }

  async inspect(input: {
    key: string;
    versionId?: string | null;
  }): Promise<InspectedAttachment | null> {
    const target = localPath(this.root, input.key);
    try {
      const details = await stat(target);
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(target)) hash.update(chunk);
      return { sizeBytes: details.size, sha256: hash.digest("hex") };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
}

function nodeReadable(body: unknown): Readable {
  if (body instanceof Readable) return body;
  if (
    typeof body === "object" &&
    body !== null &&
    "transformToWebStream" in body &&
    typeof body.transformToWebStream === "function"
  ) {
    return Readable.fromWeb(body.transformToWebStream() as never);
  }
  throw new Error("S3 returned a non-streaming attachment body");
}

export class S3AttachmentStorage implements AttachmentStorage {
  private readonly client: S3Client;

  constructor(
    region: string,
    private readonly bucket: string,
    client?: S3Client,
  ) {
    this.client = client ?? new S3Client({ region });
  }

  async put(input: {
    key: string;
    sourcePath: string;
    sizeBytes: number;
    sha256: string;
  }): Promise<StoredAttachment> {
    assertSafeKey(input.key);
    const response = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: createReadStream(input.sourcePath),
        ContentLength: input.sizeBytes,
        ContentType: "application/pdf",
        ChecksumSHA256: Buffer.from(input.sha256, "hex").toString("base64"),
        IfNoneMatch: "*",
      }),
    );
    return { versionId: response.VersionId ?? null };
  }

  async open(input: {
    key: string;
    versionId?: string | null;
    range?: AttachmentByteRange;
  }): Promise<OpenedAttachment> {
    assertSafeKey(input.key);
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        VersionId: input.versionId ?? undefined,
        Range: input.range
          ? `bytes=${input.range.start}-${input.range.end}`
          : undefined,
      }),
    );
    if (!response.Body || response.ContentLength === undefined) {
      throw new Error("S3 attachment response was incomplete");
    }
    return {
      stream: nodeReadable(response.Body),
      contentLength: response.ContentLength,
    };
  }

  async delete(input: { key: string; versionId?: string | null }): Promise<void> {
    assertSafeKey(input.key);
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        VersionId: input.versionId ?? undefined,
      }),
    );
  }

  async inspect(input: {
    key: string;
    versionId?: string | null;
  }): Promise<InspectedAttachment | null> {
    assertSafeKey(input.key);
    try {
      const response = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: input.key,
          VersionId: input.versionId ?? undefined,
          ChecksumMode: "ENABLED",
        }),
      );
      return {
        sizeBytes: response.ContentLength ?? -1,
        sha256: response.ChecksumSHA256
          ? Buffer.from(response.ChecksumSHA256, "base64").toString("hex")
          : null,
      };
    } catch (error) {
      const candidate = error as {
        name?: string;
        $metadata?: { httpStatusCode?: number };
      };
      if (
        candidate.name === "NoSuchKey" ||
        candidate.name === "NotFound" ||
        candidate.$metadata?.httpStatusCode === 404
      ) {
        return null;
      }
      throw error;
    }
  }
}
