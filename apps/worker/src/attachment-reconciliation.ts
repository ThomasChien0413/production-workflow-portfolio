import type { AttachmentStorage } from "@workflow/attachment-storage";

export type AttachmentReconciliationRecord = {
  id: string;
  storageKey: string;
  storageVersionId: string | null;
  sizeBytes: number;
  sha256: string;
};

export type AttachmentReconciliationIssue = {
  attachmentId: string;
  kind: "MISSING" | "SIZE_MISMATCH" | "HASH_MISMATCH" | "CHECKSUM_UNAVAILABLE" | "STORAGE_ERROR";
};

export async function reconcileAvailableAttachments(
  records: readonly AttachmentReconciliationRecord[],
  storage: AttachmentStorage,
): Promise<{ checked: number; issues: AttachmentReconciliationIssue[] }> {
  const issues: AttachmentReconciliationIssue[] = [];
  for (const record of records) {
    try {
      const object = await storage.inspect({
        key: record.storageKey,
        versionId: record.storageVersionId,
      });
      if (!object) {
        issues.push({ attachmentId: record.id, kind: "MISSING" });
      } else if (object.sizeBytes !== record.sizeBytes) {
        issues.push({ attachmentId: record.id, kind: "SIZE_MISMATCH" });
      } else if (!object.sha256) {
        issues.push({ attachmentId: record.id, kind: "CHECKSUM_UNAVAILABLE" });
      } else if (object.sha256 !== record.sha256) {
        issues.push({ attachmentId: record.id, kind: "HASH_MISMATCH" });
      }
    } catch {
      issues.push({ attachmentId: record.id, kind: "STORAGE_ERROR" });
    }
  }
  return { checked: records.length, issues };
}
