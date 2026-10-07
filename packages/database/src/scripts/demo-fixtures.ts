import argon2 from "argon2";
import { and, eq, sql } from "drizzle-orm";
import { departmentSeeds, sheetTemplateDefinitionSchema, type RoleCode } from "@workflow/contracts";
import { createDatabase } from "../client.js";
import { auditEvents, departments, departmentMemberships, departmentSubpages,
  departmentSubpageIdentityPermissions, departmentSubpageTemplates, productionSheets,
  roleAssignments, sheetTemplates, sheetTemplateVersions, users } from "../schema.js";
import { assertLocalDemoDatabase } from "./demo-target.js";

export const DEMO_PASSWORD = "DemoOnly2026!";
export const DEMO_SUBPAGE = "展示工作區（範例）";
export const DEMO_ACCOUNTS = [
  { username: "demo.manager", displayName: "範例主管", role: null },
  { username: "demo.staff", displayName: "範例員工／訂單人員", role: null },
  { username: "demo.sales", displayName: "範例業務", role: "SALES" },
  { username: "demo.associate", displayName: "範例協理", role: "ASSOCIATE" },
  { username: "demo.gm", displayName: "範例總經理", role: "GENERAL_MANAGER" },
] as const satisfies ReadonlyArray<{ username: string; displayName: string; role: RoleCode | null }>;

export function assertPristineDemoWorkspace(usernames: string[], sheetCount: number, subpageCount: number) {
  if (usernames.length !== 1 || usernames[0] !== "admin" || sheetCount !== 0 || subpageCount !== 0) {
    throw new Error("Demo initialization requires bootstrap admin only and no existing sheets or subpages; existing work is never overwritten");
  }
}

/** Optional local-only fixtures. Repetition never resets passwords or grants. */
export async function initializeDemoFixtures(databaseUrl: string, environment = process.env.NODE_ENV) {
  assertLocalDemoDatabase(databaseUrl, environment);
  const connection = createDatabase(databaseUrl, 1);
  try {
    return await connection.db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('portfolio-demo-fixtures-v1'))`);
      const [marker] = await tx.select({ id: auditEvents.id }).from(auditEvents).where(and(
        eq(auditEvents.action, "PORTFOLIO_DEMO_INITIALIZED"), eq(auditEvents.targetId, "v1"),
      ));
      if (marker) return { initialized: false, accounts: DEMO_ACCOUNTS.map(account => account.username), subpages: 6 };

      const existingUsers = await tx.select({ id: users.id, username: users.username, active: users.active }).from(users);
      const [sheetTotal] = await tx.select({ count: sql<number>`count(*)::int` }).from(productionSheets);
      const [subpageTotal] = await tx.select({ count: sql<number>`count(*)::int` }).from(departmentSubpages);
      assertPristineDemoWorkspace(existingUsers.map(user => user.username), sheetTotal!.count, subpageTotal!.count);
      const admin = existingUsers[0]!;
      const [adminRole] = await tx.select().from(roleAssignments).where(and(
        eq(roleAssignments.userId, admin.id), eq(roleAssignments.role, "ADMIN"), eq(roleAssignments.active, true),
      ));
      if (!admin.active || !adminRole) throw new Error("An active bootstrap administrator is required");
      const departmentRows = await tx.select().from(departments).where(eq(departments.active, true));
      if (departmentRows.length !== departmentSeeds.length || departmentSeeds.some(seed => !departmentRows.some(row => row.code === seed.code))) {
        throw new Error("Run the base department/template seed before demo initialization");
      }
      const catalogue = await tx.select({ id: sheetTemplates.id, definition: sheetTemplateVersions.definition })
        .from(sheetTemplates).innerJoin(sheetTemplateVersions, and(
          eq(sheetTemplateVersions.templateId, sheetTemplates.id),
          eq(sheetTemplateVersions.version, sheetTemplates.currentVersionNumber),
        )).where(and(eq(sheetTemplates.active, true), sql`${sheetTemplateVersions.publishedAt} is not null`));
      const templates = catalogue.map(row => ({ id: row.id, definition: sheetTemplateDefinitionSchema.parse(row.definition) }));
      if (!templates.length) throw new Error("Published demo templates are required");

      const ids = new Map<string, string>();
      for (const account of DEMO_ACCOUNTS) {
        const [created] = await tx.insert(users).values({
          username: account.username, displayName: account.displayName,
          passwordHash: await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id }), passwordWarning: true,
        }).returning({ id: users.id });
        ids.set(account.username, created!.id);
        if (account.role) await tx.insert(roleAssignments).values({ userId: created!.id, role: account.role });
      }
      const managerId = ids.get("demo.manager")!;
      const staffId = ids.get("demo.staff")!;
      for (const department of departmentRows) {
        await tx.insert(departmentMemberships).values([
          { userId: managerId, departmentId: department.id, kind: "MANAGER" },
          { userId: staffId, departmentId: department.id, kind: "STAFF" },
          { userId: staffId, departmentId: department.id, kind: "ORDER_TAKER" },
        ]);
        const [subpage] = await tx.insert(departmentSubpages).values({
          departmentId: department.id, name: DEMO_SUBPAGE, createdByUserId: managerId, updatedByUserId: managerId,
        }).returning({ id: departmentSubpages.id });
        await tx.insert(departmentSubpageIdentityPermissions).values((["STAFF", "ORDER_TAKER"] as const).map(kind => ({
          subpageId: subpage!.id, kind, canView: true, canCreate: true, canEdit: true, canSubmit: true, updatedByUserId: managerId,
        })));
        const eligible = templates.filter(template => template.definition.allowedCreatorDepartmentCodes.includes(
          department.code as typeof departmentSeeds[number]["code"],
        ));
        if (eligible.length) await tx.insert(departmentSubpageTemplates).values(eligible.map(template => ({ subpageId: subpage!.id, templateId: template.id })));
      }
      await tx.insert(auditEvents).values({ actorUserId: admin.id, action: "PORTFOLIO_DEMO_INITIALIZED",
        targetType: "portfolio_demo", targetId: "v1", metadata: { purpose: "synthetic-local-interview-fixtures", accountCount: 5, subpageCount: 6 } });
      return { initialized: true, accounts: DEMO_ACCOUNTS.map(account => account.username), subpages: 6 };
    });
  } finally { await connection.close(); }
}
