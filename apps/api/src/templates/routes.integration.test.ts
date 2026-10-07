import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { slittingRequestV1 } from "@workflow/contracts";
import {
  auditEvents,
  createDatabase,
  departments,
  sheetTemplates,
  sheetTemplateVersions,
  templateClientMutations,
  users,
} from "@workflow/database";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const appOrigin = "http://localhost:3000";

function cookieHeader(response: {
  headers: Record<string, string | string[] | number | undefined>;
}): string {
  const raw = response.headers["set-cookie"];
  const lines = Array.isArray(raw) ? raw : [typeof raw === "string" ? raw : ""];
  return lines
    .flatMap((line) => {
      const pair = line.split(";", 1)[0];
      return pair ? [pair] : [];
    })
    .join("; ");
}

function csrfToken(response: {
  headers: Record<string, string | string[] | number | undefined>;
}): string {
  const raw = response.headers["set-cookie"];
  const lines = Array.isArray(raw) ? raw : [typeof raw === "string" ? raw : ""];
  const cookie = lines
    .map((line) => line.split(";", 1)[0])
    .find((pair) => pair?.startsWith("workflow_csrf="));
  if (!cookie) throw new Error("Missing CSRF cookie");
  return decodeURIComponent(cookie.slice("workflow_csrf=".length));
}

describe.skipIf(!testDatabaseUrl)("template administration routes", () => {
  it("returns the published image-derived template to ADMIN and denies ordinary users", async () => {
    const connection = createDatabase(testDatabaseUrl!, 1);
    const suffix = randomUUID().slice(0, 8);
    const username = `vitest-template-${suffix}`;
    let staffId: string | null = null;
    const app = await buildApp(
      loadConfig({
        DATABASE_URL: testDatabaseUrl,
        NODE_ENV: "test",
        APP_ORIGIN: appOrigin,
      }),
    );

    try {
      const adminLogin = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { origin: appOrigin },
        payload: { username: "admin", password: "DemoOnly2026!" },
      });
      expect(adminLogin.statusCode).toBe(200);

      const templatesResponse = await app.inject({
        method: "GET",
        url: "/api/admin/templates",
        headers: { cookie: cookieHeader(adminLogin) },
      });
      expect(templatesResponse.statusCode).toBe(200);
      expect(templatesResponse.json().templates).toContainEqual(
        expect.objectContaining({
          slug: "slitting-request",
          displayName: "分條申請單",
          // Versions 1 and 2 remain immutable; version 3 adds only the
          // approved 訂單人員 permission policy for new sheets.
          active: true,
          currentVersionNumber: 3,
          department: expect.objectContaining({
            code: "SLITTING",
            displayName: "分條",
          }),
          versions: expect.arrayContaining([
            expect.objectContaining({
              version: 1,
              definitionValid: true,
              publishedAt: expect.any(String),
              definition: expect.objectContaining({
                status: "APPROVED",
                openQuestions: [],
                allowedCreatorDepartmentCodes: [
                  "SLITTING",
                  "CUT",
                  "STAMPING",
                  "FLAT_SHEAR",
                  "WAREHOUSE",
                ],
                workflow: expect.objectContaining({
                  approvalRoles: [
                    "SALES",
                    "ASSOCIATE",
                    "GENERAL_MANAGER",
                  ],
                  destinationDepartmentCode: "SLITTING",
                  avoidSelfHandoff: true,
                }),
              }),
            }),
            expect.objectContaining({
              version: 2,
              definitionValid: true,
              publishedAt: expect.any(String),
              definition: expect.objectContaining({
                headerLayout: "DATE_TITLE_DOCUMENT",
                printLayout: {
                  paperSize: "A4",
                  orientation: "LANDSCAPE",
                  marginMm: 8,
                },
              }),
            }),
            expect.objectContaining({
              version: 3,
              definitionValid: true,
              publishedAt: expect.any(String),
              definition: expect.objectContaining({
                allowedCreatorKinds: ["MANAGER", "ORDER_TAKER"],
                allowedEditorKinds: ["MANAGER", "ORDER_TAKER"],
                allowedSubmitterKinds: ["MANAGER", "ORDER_TAKER"],
                staffEditScope: "ANY_IN_DEPARTMENT",
              }),
            }),
          ]),
        }),
      );

      const [staff] = await connection.db
        .insert(users)
        .values({
          username,
          displayName: "範本權限測試",
          passwordHash: await argon2.hash("template-test-password", {
            type: argon2.argon2id,
          }),
          passwordWarning: false,
        })
        .returning({ id: users.id });
      staffId = staff!.id;
      const staffLogin = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { origin: appOrigin },
        payload: { username, password: "template-test-password" },
      });
      expect(staffLogin.statusCode).toBe(200);
      const denied = await app.inject({
        method: "GET",
        url: "/api/admin/templates",
        headers: { cookie: cookieHeader(staffLogin) },
      });
      expect(denied.statusCode).toBe(403);
      const adminTemplate = templatesResponse
        .json()
        .templates.find((template: { slug: string }) => template.slug === "slitting-request");
      const deniedWrite = await app.inject({
        method: "POST",
        url: `/api/admin/templates/${adminTemplate.id}/versions`,
        headers: {
          origin: appOrigin,
          cookie: cookieHeader(staffLogin),
          "x-csrf-token": csrfToken(staffLogin),
        },
        payload: {
          clientMutationId: randomUUID(),
          definition: slittingRequestV1,
        },
      });
      expect(deniedWrite.statusCode).toBe(403);
    } finally {
      await app.close();
      if (staffId) {
        await connection.db
          .delete(auditEvents)
          .where(eq(auditEvents.actorUserId, staffId));
        await connection.db.delete(users).where(eq(users.id, staffId));
      }
      await connection.close();
    }
  });

  it("publishes immutable versions with explicit activation and safe audit history", async () => {
    const connection = createDatabase(testDatabaseUrl!, 2);
    const suffix = randomUUID().slice(0, 8);
    const slug = `vitest-template-${suffix}`;
    let templateId: string | null = null;
    const versionIds: string[] = [];
    const app = await buildApp(
      loadConfig({
        DATABASE_URL: testDatabaseUrl,
        NODE_ENV: "test",
        APP_ORIGIN: appOrigin,
      }),
    );

    try {
      const [department] = await connection.db
        .select({ id: departments.id })
        .from(departments)
        .where(eq(departments.code, "SLITTING"))
        .limit(1);
      if (!department) throw new Error("Seeded 分條 department is missing");
      const [template] = await connection.db
        .insert(sheetTemplates)
        .values({
          departmentId: department.id,
          slug,
          displayName: "版本流程測試表單",
          description: "僅供自動化測試",
        })
        .returning({ id: sheetTemplates.id });
      if (!template) throw new Error("Failed to create template fixture");
      templateId = template.id;

      const adminLogin = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { origin: appOrigin },
        payload: { username: "admin", password: "DemoOnly2026!" },
      });
      expect(adminLogin.statusCode).toBe(200);
      const cookie = cookieHeader(adminLogin);
      const csrf = csrfToken(adminLogin);
      const writeHeaders = {
        origin: appOrigin,
        cookie,
        "x-csrf-token": csrf,
      };
      const legacyApprovedDefinition = {
        ...slittingRequestV1,
        templateKey: slug,
        displayName: "版本流程測試表單",
      };
      const approvedDefinition = {
        ...legacyApprovedDefinition,
        printLayout: {
          paperSize: "A4" as const,
          orientation: "LANDSCAPE" as const,
          marginMm: 8,
        },
      };
      const draftDefinition = {
        ...approvedDefinition,
        status: "DRAFT_PENDING_CONFIRMATION" as const,
        openQuestions: ["僅供測試：尚待確認"],
      };

      const missingCsrf = await app.inject({
        method: "POST",
        url: `/api/admin/templates/${templateId}/versions`,
        headers: { origin: appOrigin, cookie },
        payload: {
          clientMutationId: randomUUID(),
          definition: draftDefinition,
        },
      });
      expect(missingCsrf.statusCode).toBe(403);

      const activateWithoutPublishedVersion = await app.inject({
        method: "PATCH",
        url: `/api/admin/templates/${templateId}`,
        headers: writeHeaders,
        payload: { clientMutationId: randomUUID(), active: true },
      });
      expect(activateWithoutPublishedVersion.statusCode).toBe(409);

      const wrongIdentity = await app.inject({
        method: "POST",
        url: `/api/admin/templates/${templateId}/versions`,
        headers: writeHeaders,
        payload: {
          clientMutationId: randomUUID(),
          definition: slittingRequestV1,
        },
      });
      expect(wrongIdentity.statusCode).toBe(409);

      const createDraftMutationId = randomUUID();
      const createdDraft = await app.inject({
        method: "POST",
        url: `/api/admin/templates/${templateId}/versions`,
        headers: writeHeaders,
        payload: {
          clientMutationId: createDraftMutationId,
          definition: draftDefinition,
          sourceReference: "test-only/source.png",
          changeNotes: "測試草稿",
        },
      });
      expect(createdDraft.statusCode).toBe(201);
      expect(createdDraft.json()).toMatchObject({ version: 1 });
      const versionOneId = createdDraft.json().versionId as string;
      versionIds.push(versionOneId);
      const replayedDraft = await app.inject({
        method: "POST",
        url: `/api/admin/templates/${templateId}/versions`,
        headers: writeHeaders,
        payload: {
          clientMutationId: createDraftMutationId,
          definition: draftDefinition,
          sourceReference: "test-only/source.png",
          changeNotes: "測試草稿",
        },
      });
      expect(replayedDraft.statusCode).toBe(201);
      expect(replayedDraft.json()).toMatchObject({
        versionId: versionOneId,
        version: 1,
        replayed: true,
      });
      const reusedMutationKey = await app.inject({
        method: "PATCH",
        url: `/api/admin/templates/${templateId}`,
        headers: writeHeaders,
        payload: { clientMutationId: createDraftMutationId, active: false },
      });
      expect(reusedMutationKey.statusCode).toBe(409);

      const refusedDraftPublication = await app.inject({
        method: "POST",
        url: `/api/admin/templates/${templateId}/versions/${versionOneId}/publish`,
        headers: writeHeaders,
        payload: { clientMutationId: randomUUID(), active: true },
      });
      expect(refusedDraftPublication.statusCode).toBe(409);

      const approvedWithoutPrintLayout = await app.inject({
        method: "PUT",
        url: `/api/admin/templates/${templateId}/versions/${versionOneId}`,
        headers: writeHeaders,
        payload: {
          clientMutationId: randomUUID(),
          definition: legacyApprovedDefinition,
          sourceReference: "test-only/source.png",
          changeNotes: "測試缺少列印版面",
        },
      });
      expect(approvedWithoutPrintLayout.statusCode).toBe(200);
      const refusedMissingPrintLayout = await app.inject({
        method: "POST",
        url: `/api/admin/templates/${templateId}/versions/${versionOneId}/publish`,
        headers: writeHeaders,
        payload: { clientMutationId: randomUUID(), active: true },
      });
      expect(refusedMissingPrintLayout.statusCode).toBe(409);

      const updatedDraft = await app.inject({
        method: "PUT",
        url: `/api/admin/templates/${templateId}/versions/${versionOneId}`,
        headers: writeHeaders,
        payload: {
          clientMutationId: randomUUID(),
          definition: approvedDefinition,
          sourceReference: "test-only/source.png",
          changeNotes: "測試核准版本",
        },
      });
      expect(updatedDraft.statusCode).toBe(200);

      const publishVersionOneMutationId = randomUUID();
      const publishedVersionOne = await app.inject({
        method: "POST",
        url: `/api/admin/templates/${templateId}/versions/${versionOneId}/publish`,
        headers: writeHeaders,
        payload: {
          clientMutationId: publishVersionOneMutationId,
          active: true,
        },
      });
      expect(publishedVersionOne.statusCode).toBe(200);
      expect(publishedVersionOne.json().template).toMatchObject({
        active: true,
        currentVersionNumber: 1,
      });
      const replayedPublication = await app.inject({
        method: "POST",
        url: `/api/admin/templates/${templateId}/versions/${versionOneId}/publish`,
        headers: writeHeaders,
        payload: {
          clientMutationId: publishVersionOneMutationId,
          active: true,
        },
      });
      expect(replayedPublication.statusCode).toBe(200);
      expect(replayedPublication.json()).toMatchObject({
        versionId: versionOneId,
        replayed: true,
      });

      const immutablePublishedVersion = await app.inject({
        method: "PUT",
        url: `/api/admin/templates/${templateId}/versions/${versionOneId}`,
        headers: writeHeaders,
        payload: {
          clientMutationId: randomUUID(),
          definition: approvedDefinition,
        },
      });
      expect(immutablePublishedVersion.statusCode).toBe(409);

      const retired = await app.inject({
        method: "PATCH",
        url: `/api/admin/templates/${templateId}`,
        headers: writeHeaders,
        payload: { clientMutationId: randomUUID(), active: false },
      });
      expect(retired.statusCode).toBe(200);
      expect(retired.json().template.active).toBe(false);
      const reactivated = await app.inject({
        method: "PATCH",
        url: `/api/admin/templates/${templateId}`,
        headers: writeHeaders,
        payload: { clientMutationId: randomUUID(), active: true },
      });
      expect(reactivated.statusCode).toBe(200);
      expect(reactivated.json().template.active).toBe(true);

      const concurrentDrafts = await Promise.all(
        ["第二版測試", "第三版測試"].map((changeNotes) =>
          app.inject({
            method: "POST",
            url: `/api/admin/templates/${templateId}/versions`,
            headers: writeHeaders,
            payload: {
              clientMutationId: randomUUID(),
              definition: approvedDefinition,
              changeNotes,
            },
          }),
        ),
      );
      expect(concurrentDrafts.map((response) => response.statusCode)).toEqual([
        201, 201,
      ]);
      const concurrentVersions = concurrentDrafts
        .map((response) => response.json() as { version: number; versionId: string })
        .sort((left, right) => left.version - right.version);
      expect(concurrentVersions.map((version) => version.version)).toEqual([2, 3]);
      versionIds.push(...concurrentVersions.map((version) => version.versionId));

      const versionThree = concurrentVersions[1]!;
      const publishedVersionThree = await app.inject({
        method: "POST",
        url: `/api/admin/templates/${templateId}/versions/${versionThree.versionId}/publish`,
        headers: writeHeaders,
        payload: { clientMutationId: randomUUID(), active: false },
      });
      expect(publishedVersionThree.statusCode).toBe(200);
      expect(publishedVersionThree.json().template).toMatchObject({
        active: false,
        currentVersionNumber: 3,
      });

      const staleDraftPublication = await app.inject({
        method: "POST",
        url: `/api/admin/templates/${templateId}/versions/${concurrentVersions[0]!.versionId}/publish`,
        headers: writeHeaders,
        payload: { clientMutationId: randomUUID(), active: true },
      });
      expect(staleDraftPublication.statusCode).toBe(409);

      const [storedVersionOne] = await connection.db
        .select({
          definition: sheetTemplateVersions.definition,
          publishedAt: sheetTemplateVersions.publishedAt,
          publishedByUserId: sheetTemplateVersions.publishedByUserId,
        })
        .from(sheetTemplateVersions)
        .where(eq(sheetTemplateVersions.id, versionOneId));
      expect(storedVersionOne).toMatchObject({
        definition: approvedDefinition,
        publishedAt: expect.any(Date),
        publishedByUserId: adminLogin.json().user.id,
      });

      const templateAudit = await connection.db
        .select({
          action: auditEvents.action,
          metadata: auditEvents.metadata,
        })
        .from(auditEvents)
        .where(
          inArray(auditEvents.targetId, [templateId, ...versionIds]),
        );
      expect(templateAudit.map((event) => event.action)).toEqual(
        expect.arrayContaining([
          "TEMPLATE_VERSION_CREATED",
          "TEMPLATE_VERSION_UPDATED",
          "TEMPLATE_VERSION_PUBLISHED",
          "TEMPLATE_RETIRED",
          "TEMPLATE_ACTIVATED",
        ]),
      );
      expect(
        templateAudit.filter(
          (event) => event.action === "TEMPLATE_VERSION_CREATED",
        ),
      ).toHaveLength(3);
      expect(
        templateAudit.filter(
          (event) => event.action === "TEMPLATE_VERSION_PUBLISHED",
        ),
      ).toHaveLength(2);
      expect(JSON.stringify(templateAudit.map((event) => event.metadata))).not.toContain(
        '"sections"',
      );
    } finally {
      await app.close();
      if (templateId) {
        await connection.db
          .delete(auditEvents)
          .where(
            inArray(auditEvents.targetId, [templateId, ...versionIds]),
          );
        await connection.db
          .delete(templateClientMutations)
          .where(eq(templateClientMutations.templateId, templateId));
        await connection.db
          .delete(sheetTemplateVersions)
          .where(eq(sheetTemplateVersions.templateId, templateId));
        await connection.db
          .delete(sheetTemplates)
          .where(eq(sheetTemplates.id, templateId));
      }
      await connection.close();
    }
  }, 20_000);
});
