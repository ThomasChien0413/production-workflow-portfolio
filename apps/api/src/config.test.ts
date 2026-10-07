import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("API configuration", () => {
  it("uses safe development defaults", () => {
    const config = loadConfig({
      DATABASE_URL: "postgres://localhost/workflow",
      NODE_ENV: "development",
    });

    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(3001);
    expect(config.secureCookies).toBe(false);
    expect(config.loginLockThreshold).toBe(5);
    expect(config.webPushVapidPublicKey).toBeNull();
    expect(config.attachmentStorageDriver).toBe("filesystem");
    expect(config.attachmentMaxBytes).toBe(95_000_000);
    expect(config.attachmentUploadConcurrency).toBe(2);
  });

  // Push replaced LINE (the user, 2026-10-04); production needs its key.
  it("requires the web push public key in production", () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: "postgres://localhost/workflow",
        NODE_ENV: "production",
        AWS_REGION: "ap-northeast-1",
        ATTACHMENT_STORAGE_DRIVER: "s3",
        ATTACHMENT_S3_BUCKET: "workflow-production-attachments",
      }),
    ).toThrow("Production needs the web push public key");
  });

  it("requires secure cookies in production", () => {
    const config = loadConfig({
      DATABASE_URL: "postgres://localhost/workflow",
      NODE_ENV: "production",
      AWS_REGION: "ap-northeast-1",
      ATTACHMENT_STORAGE_DRIVER: "s3",
      ATTACHMENT_S3_BUCKET: "workflow-production-attachments",
      WEB_PUSH_VAPID_PUBLIC_KEY: "BPublicKey",
    });

    expect(config.secureCookies).toBe(true);
    expect(config.attachmentStorageDriver).toBe("s3");
  });

  it("treats a blank web push key as absent", () => {
    expect(
      loadConfig({ DATABASE_URL: "postgres://localhost/workflow", WEB_PUSH_VAPID_PUBLIC_KEY: "  " }).webPushVapidPublicKey,
    ).toBeNull();
    expect(
      loadConfig({ DATABASE_URL: "postgres://localhost/workflow", WEB_PUSH_VAPID_PUBLIC_KEY: "BKey" }).webPushVapidPublicKey,
    ).toBe("BKey");
  });

  it("rejects attachment prefixes that can leave the configured storage root", () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: "postgres://localhost/workflow",
        ATTACHMENT_S3_PREFIX: "../outside",
      }),
    ).toThrow();
  });

  it("enforces decimal 95 MB, accepts the ceiling, and permits smaller limits", () => {
    for (const limit of ["95000000", "1000000"]) {
      expect(loadConfig({ DATABASE_URL: "postgres://localhost/workflow", ATTACHMENT_MAX_BYTES: limit })
        .attachmentMaxBytes).toBe(Number(limit));
    }
    for (const limit of ["95000001", "99614720", "100000000", "104857600"]) {
      expect(() => loadConfig({ DATABASE_URL: "postgres://localhost/workflow", ATTACHMENT_MAX_BYTES: limit }))
        .toThrow();
    }
  });
});
