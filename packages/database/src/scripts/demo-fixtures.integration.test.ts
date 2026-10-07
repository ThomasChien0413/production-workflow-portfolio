import argon2 from "argon2";
import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDatabase } from "../client.js";
import { auditEvents, users, departmentMemberships, departmentSubpages, departmentSubpageIdentityPermissions,
  departmentSubpageTemplates, sheetTemplates, sheetTemplateVersions, departments, productionSheets, roleAssignments } from "../schema.js";
import { sheetTemplateDefinitionSchema } from "@workflow/contracts";
import { assertLocalDemoDatabase } from "./demo-target.js";
import { DEMO_ACCOUNTS, DEMO_PASSWORD, DEMO_SUBPAGE, initializeDemoFixtures } from "./demo-fixtures.js";

const url = process.env.DEMO_TEST_DATABASE_URL;

describe.skipIf(!url)("isolated optional demo initialization", () => {
  it("commits once under concurrent calls, preserves edits on replay and selects only eligible published templates", async () => {
    assertLocalDemoDatabase(url!, "test");
    if (new URL(url!).pathname !== "/workflow_demo_fixture_test") throw new Error("Fixture tests require their dedicated disposable database");
    const connection = createDatabase(url!, 1);
    try {
      const results = await Promise.all([initializeDemoFixtures(url!, "test"), initializeDemoFixtures(url!, "test")]);
      expect(results.filter(result => result.initialized)).toHaveLength(1);
      const accounts = await connection.db.select().from(users).where(inArray(users.username, DEMO_ACCOUNTS.map(account => account.username)));
      expect(accounts).toHaveLength(5);
      for (const account of accounts) expect(await argon2.verify(account.passwordHash, DEMO_PASSWORD)).toBe(true);
      const pages = await connection.db.select().from(departmentSubpages).where(eq(departmentSubpages.name, DEMO_SUBPAGE));
      expect(pages).toHaveLength(6);
      const identities = await connection.db.select().from(departmentMemberships).where(inArray(departmentMemberships.userId, accounts.map(account => account.id)));
      expect(identities).toHaveLength(18);
      expect(await connection.db.select().from(productionSheets)).toHaveLength(0);
      const selections = await connection.db.select({ code: departments.code, definition: sheetTemplateVersions.definition })
        .from(departmentSubpageTemplates).innerJoin(departmentSubpages, eq(departmentSubpages.id, departmentSubpageTemplates.subpageId))
        .innerJoin(departments, eq(departments.id, departmentSubpages.departmentId))
        .innerJoin(sheetTemplates, eq(sheetTemplates.id, departmentSubpageTemplates.templateId))
        .innerJoin(sheetTemplateVersions, and(eq(sheetTemplateVersions.templateId, sheetTemplates.id), eq(sheetTemplateVersions.version, sheetTemplates.currentVersionNumber)));
      expect(selections.length).toBeGreaterThan(0);
      for (const selection of selections) expect(sheetTemplateDefinitionSchema.parse(selection.definition).allowedCreatorDepartmentCodes).toContain(selection.code);

      const staff = accounts.find(account => account.username === "demo.staff")!;
      const changedHash = await argon2.hash("changed-demo-password-only", { type: argon2.argon2id });
      await connection.db.update(users).set({ active: false, passwordHash: changedHash }).where(eq(users.id, staff.id));
      await connection.db.update(departmentSubpageIdentityPermissions).set({ canView: false, canCreate: false, canEdit: false, canSubmit: false });
      expect((await initializeDemoFixtures(url!, "test")).initialized).toBe(false);
      const [unchanged] = await connection.db.select().from(users).where(eq(users.id, staff.id));
      expect(unchanged?.active).toBe(false);
      expect(unchanged?.passwordHash).toBe(changedHash);
      expect((await connection.db.select().from(departmentSubpageIdentityPermissions)).every(grant => !grant.canView && !grant.canEdit)).toBe(true);
      const markers = await connection.db.select().from(auditEvents).where(eq(auditEvents.action, "PORTFOLIO_DEMO_INITIALIZED"));
      expect(markers).toHaveLength(1);
      expect(markers[0]?.metadata).toEqual({ purpose: "synthetic-local-interview-fixtures", accountCount: 5, subpageCount: 6 });

      // Reset only rows owned by this test in its exact dedicated disposable DB.
      await connection.db.delete(auditEvents).where(eq(auditEvents.action, "PORTFOLIO_DEMO_INITIALIZED"));
      await connection.db.delete(departmentSubpages).where(inArray(departmentSubpages.id, pages.map(page => page.id)));
      await connection.db.delete(roleAssignments).where(inArray(roleAssignments.userId, accounts.map(account => account.id)));
      await connection.db.delete(users).where(inArray(users.id, accounts.map(account => account.id)));
      const [manual] = await connection.db.insert(users).values({ username: "manual-demo-test", displayName: "手動測試範例", passwordHash: changedHash }).returning({ id: users.id });
      try {
        await expect(initializeDemoFixtures(url!, "test")).rejects.toThrow(/never overwritten/u);
        expect(await connection.db.select().from(departmentSubpages)).toHaveLength(0);
        expect(await connection.db.select().from(auditEvents).where(eq(auditEvents.action, "PORTFOLIO_DEMO_INITIALIZED"))).toHaveLength(0);
      } finally { await connection.db.delete(users).where(eq(users.id, manual!.id)); }
    } finally { await connection.close(); }
  }, 30_000);
});
