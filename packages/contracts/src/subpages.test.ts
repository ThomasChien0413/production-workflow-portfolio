import { describe, expect, it } from "vitest";
import {
  departmentSubpagePageSchema,
  replaceSubpageIdentityPermissionsRequestSchema,
  replaceSubpageTemplatesRequestSchema,
  updateDepartmentSubpageRequestSchema,
} from "./subpages.js";

const userId = "11111111-1111-4111-8111-111111111111";
const clientMutationId = "22222222-2222-4222-8222-222222222222";

describe("department subpage contracts", () => {
  it("requires 查看 whenever a dependent permission is enabled", () => {
    const base = { clientMutationId, revision: 1 };
    expect(replaceSubpageIdentityPermissionsRequestSchema.safeParse({
      ...base,
      permissions: [
        { kind: "ORDER_TAKER", canView: false, canCreate: true, canEdit: false, canSubmit: false },
        { kind: "STAFF", canView: false, canCreate: false, canEdit: false, canSubmit: false },
      ],
    }).success).toBe(false);
    expect(replaceSubpageIdentityPermissionsRequestSchema.safeParse({
      ...base,
      permissions: [
        { kind: "ORDER_TAKER", canView: true, canCreate: true, canEdit: true, canSubmit: true },
        { kind: "STAFF", canView: false, canCreate: false, canEdit: false, canSubmit: false },
      ],
    }).success).toBe(true);
  });

  it("rejects duplicate identities and duplicate templates", () => {
    const permission = { kind: "STAFF", canView: true, canCreate: false, canEdit: false, canSubmit: false };
    expect(replaceSubpageIdentityPermissionsRequestSchema.safeParse({
      clientMutationId,
      revision: 1,
      permissions: [permission, permission],
    }).success).toBe(false);
    expect(replaceSubpageTemplatesRequestSchema.safeParse({
      clientMutationId,
      revision: 1,
      templateIds: [userId, userId],
    }).success).toBe(false);
  });

  it("accepts optimistic rename and reorder mutations", () => {
    expect(updateDepartmentSubpageRequestSchema.parse({
      clientMutationId,
      revision: 3,
      name: "小分條",
      position: 1,
    })).toMatchObject({ name: "小分條", position: 1 });
  });

  it("validates the shared settings/list response without usernames", () => {
    expect(departmentSubpagePageSchema.parse({
      canManage: true,
      subpages: [{
        id: "33333333-3333-4333-8333-333333333333",
        departmentId: "44444444-4444-4444-8444-444444444444",
        name: "大分條",
        position: 0,
        revision: 1,
        sheetCount: 0,
        capabilities: { canView: true, canCreate: true, canEdit: true, canSubmit: true },
        identityPermissions: [],
        enabledTemplateIds: [],
      }],
      eligibleTemplates: [],
      eligibleUsers: [{ id: userId, displayName: "測試員工", kinds: ["STAFF"], manager: false }],
    }).eligibleUsers[0]).not.toHaveProperty("username");
  });

  it("loads the response schema without deriving from the refined permission schema", () => {
    expect(departmentSubpagePageSchema.shape.subpages).toBeDefined();
  });
});
