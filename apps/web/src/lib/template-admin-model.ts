import type { TemplateDefinition } from "./sheet-model";

/**
 * Client-safe template administration types.
 *
 * Separate from lib/templates.ts, which imports `next/headers` to fetch.
 */
export type AdminTemplateVersion = {
  id: string;
  version: number;
  /** Null when the stored definition no longer parses against the schema. */
  definition: TemplateDefinition | null;
  definitionValid: boolean;
  requiresReview: boolean;
  sourceReference: string | null;
  changeNotes: string | null;
  /** Null while the version is still an editable draft. */
  publishedAt: string | null;
  createdAt: string;
};

export type AdminTemplate = {
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  active: boolean;
  currentVersionNumber: number | null;
  department: { id: string; code: string; displayName: string };
  versions: AdminTemplateVersion[];
};

export function isPublished(version: AdminTemplateVersion): boolean {
  return version.publishedAt !== null;
}

/**
 * Why a version cannot be published yet, in the order the API checks it.
 *
 * The server is the authority and re-runs all of this; showing it up front
 * saves an administrator from pressing 發布 to be told one problem at a time.
 */
export function publicationBlockers(version: AdminTemplateVersion): string[] {
  if (!version.definitionValid || !version.definition) {
    return ["定義不符合目前的結構描述，無法解析。"];
  }
  const definition = version.definition;
  const blockers: string[] = [];
  if (definition.status !== "APPROVED") {
    blockers.push("定義狀態仍為草稿（DRAFT_PENDING_CONFIRMATION），必須先確認為 APPROVED。");
  }
  if (definition.openQuestions.length > 0) {
    blockers.push(`尚有 ${definition.openQuestions.length} 個待確認問題。`);
  }
  if (!definition.printLayout) {
    blockers.push("尚未設定 A4 列印版面，無法發布新版本。");
  }
  if (!version.sourceReference) {
    blockers.push("缺少來源影像指紋（sourceReference）。");
  }
  return blockers;
}
