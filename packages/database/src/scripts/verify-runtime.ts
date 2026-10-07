import "./load-env.js";
import { assertLocalDemoDatabase } from "./demo-target.js";
import { and, count, eq, isNotNull } from "drizzle-orm";
import {
  departmentSeeds,
  sheetTemplateDefinitionSchema,
} from "@workflow/contracts";
import { createDatabase } from "../client.js";
import {
  departments,
  roleAssignments,
  sheetTemplates,
  sheetTemplateVersions,
  users,
} from "../schema.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
assertLocalDemoDatabase(databaseUrl, process.env.NODE_ENV, true);

const connection = createDatabase(databaseUrl, 1);

try {
  const [activeDepartments, activeAdminRows, publishedVersions, activeTemplates] =
    await Promise.all([
      connection.db
        .select({ code: departments.code, displayName: departments.displayName })
        .from(departments)
        .where(eq(departments.active, true)),
      connection.db
        .select({ value: count() })
        .from(users)
        .innerJoin(
          roleAssignments,
          and(
            eq(roleAssignments.userId, users.id),
            eq(roleAssignments.role, "ADMIN"),
            eq(roleAssignments.active, true),
          ),
        )
        .where(eq(users.active, true)),
      connection.db
        .select({ definition: sheetTemplateVersions.definition })
        .from(sheetTemplateVersions)
        .where(isNotNull(sheetTemplateVersions.publishedAt)),
      connection.db
        .select({
          templateId: sheetTemplates.id,
          currentVersionNumber: sheetTemplates.currentVersionNumber,
          version: sheetTemplateVersions.version,
          publishedAt: sheetTemplateVersions.publishedAt,
        })
        .from(sheetTemplates)
        .leftJoin(
          sheetTemplateVersions,
          and(
            eq(sheetTemplateVersions.templateId, sheetTemplates.id),
            eq(sheetTemplateVersions.version, sheetTemplates.currentVersionNumber),
          ),
        )
        .where(eq(sheetTemplates.active, true)),
    ]);

  const expectedDepartments = new Map<string, string>(
    departmentSeeds.map((department) => [department.code, department.displayName]),
  );
  if (
    activeDepartments.length !== expectedDepartments.size ||
    activeDepartments.some(
      (department) =>
        expectedDepartments.get(department.code) !== department.displayName,
    )
  ) {
    throw new Error("Active department catalogue verification failed");
  }
  if ((activeAdminRows[0]?.value ?? 0) < 1) {
    throw new Error("No active ADMIN account is available");
  }
  for (const version of publishedVersions) {
    sheetTemplateDefinitionSchema.parse(version.definition);
  }
  if (
    activeTemplates.some(
      (template) =>
        template.currentVersionNumber === null ||
        template.version !== template.currentVersionNumber ||
        template.publishedAt === null,
    )
  ) {
    throw new Error("An active template does not point to a published current version");
  }

  process.stdout.write(
    `Runtime database verification passed (${activeDepartments.length} departments, ${publishedVersions.length} published template versions, ${activeTemplates.length} active templates).\n`,
  );
} finally {
  await connection.close();
}
