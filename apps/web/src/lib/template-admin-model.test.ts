import { describe, expect, it } from "vitest";
import { slittingRequestV1, slittingRequestV2 } from "@workflow/contracts";
import {
  publicationBlockers,
  type AdminTemplateVersion,
} from "./template-admin-model.js";

function draftVersion(
  definition: AdminTemplateVersion["definition"],
): AdminTemplateVersion {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    version: 2,
    definition,
    definitionValid: true,
    requiresReview: true,
    sourceReference: "test-only/source.png",
    changeNotes: "test-only",
    publishedAt: null,
    createdAt: "2026-08-12T00:00:00.000Z",
  };
}

describe("template publication blockers", () => {
  it("allows legacy published definitions to parse but blocks republishing without print settings", () => {
    expect(publicationBlockers(draftVersion(slittingRequestV1))).toContain(
      "尚未設定 A4 列印版面，無法發布新版本。",
    );
  });

  it("accepts a new version with explicit immutable print settings", () => {
    expect(publicationBlockers(draftVersion(slittingRequestV2))).toEqual([]);
  });
});
