import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { and, desc, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  approvalRuns,
  auditEvents,
  createDatabase,
  departmentMemberships,
  departmentSubpageIdentityPermissions,
  departmentSubpages,
  departments,
  productionSheets,
  sheetClientMutations,
  sheetRowMarks,
  sheetTemplateVersions,
  sheetTemplates,
  users,
} from "@workflow/database";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const appOrigin = "http://localhost:3000";

function cookies(response: { headers: Record<string, string | string[] | number | undefined> }) {
  const raw = response.headers["set-cookie"];
  const lines = Array.isArray(raw) ? raw : [typeof raw === "string" ? raw : ""];
  const pairs = lines.flatMap((line) => {
    const pair = line.split(";", 1)[0];
    return pair ? [pair] : [];
  });
  const csrf = pairs.find((pair) => pair.startsWith("workflow_csrf="))?.slice("workflow_csrf=".length);
  if (!csrf) throw new Error("CSRF cookie missing");
  return { cookie: pairs.join("; "), csrf };
}

/**
 * 分條's 主管 ticks off 分條申請單's rows once the sheet is in 分條 with its
 * review done (the user, 2026-10-03). Before then, and in any other
 * department, a sheet shows no ticks and refuses them; 分條's other people see
 * the ticks but cannot change them.
 */
describe.skipIf(!testDatabaseUrl)("分條申請單 row ticks", () => {
  it("are 分條's 主管's to set, once the sheet has arrived with its review done", async () => {
    const connection = createDatabase(testDatabaseUrl!, 1);
    const suffix = randomUUID().slice(0, 8);
    const password = `RowMarks-${suffix}-Password!`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const userIds: string[] = [];
    const sheetIds: string[] = [];
    let subpageId: string | null = null;
    const app = await buildApp(loadConfig({ DATABASE_URL: testDatabaseUrl, NODE_ENV: "test", APP_ORIGIN: appOrigin }));

    try {
      const departmentRows = await connection.db.select({ id: departments.id, code: departments.code }).from(departments);
      const byCode = new Map(departmentRows.map((row) => [row.code, row.id]));
      const slittingId = byCode.get("SLITTING")!;
      const cutId = byCode.get("CUT")!;
      const [version] = await connection.db
        .select({ id: sheetTemplateVersions.id })
        .from(sheetTemplateVersions)
        .innerJoin(sheetTemplates, and(
          eq(sheetTemplates.id, sheetTemplateVersions.templateId),
          eq(sheetTemplateVersions.version, sheetTemplates.currentVersionNumber),
        ))
        .where(eq(sheetTemplates.slug, "slitting-request"))
        .limit(1);
      if (!version) throw new Error("分條申請單 is not seeded");

      const [subpage] = await connection.db.insert(departmentSubpages)
        .values({ departmentId: slittingId, name: `勾選測試-${suffix}`, position: 100 })
        .returning({ id: departmentSubpages.id });
      subpageId = subpage!.id;
      // 分條's 員工 may view and edit in this subpage, but ticks are 主管's.
      await connection.db.insert(departmentSubpageIdentityPermissions).values({
        subpageId, kind: "STAFF", canView: true, canCreate: false, canEdit: true, canSubmit: false,
      });

      async function person(label: string, departmentId: string, kind: "MANAGER" | "STAFF") {
        const [user] = await connection.db.insert(users).values({
          username: `row-marks-${label}-${suffix}`,
          displayName: `勾選測試 ${label}`,
          passwordHash,
        }).returning({ id: users.id, username: users.username });
        if (!user) throw new Error("Failed to create user");
        userIds.push(user.id);
        await connection.db.insert(departmentMemberships).values({ userId: user.id, departmentId, kind });
        const login = await app.inject({ method: "POST", url: "/api/auth/login", headers: { origin: appOrigin }, payload: { username: user.username, password } });
        expect(login.statusCode).toBe(200);
        return { ...user, ...cookies(login) };
      }
      const manager = await person("slitting-manager", slittingId, "MANAGER");
      const staff = await person("slitting-staff", slittingId, "STAFF");
      const cutManager = await person("cut-manager", cutId, "MANAGER");

      async function sheet(options: { departmentId: string; reviewed: boolean; archived?: boolean }) {
        const id = randomUUID();
        sheetIds.push(id);
        await connection.db.insert(productionSheets).values({
          id,
          sheetNumber: id,
          templateVersionId: version!.id,
          originDepartmentId: cutId,
          currentDepartmentId: options.departmentId,
          subpageId: options.departmentId === slittingId ? subpageId : null,
          createdByUserId: cutManager.id,
          state: options.archived ? "ARCHIVED" : "READY",
          archivedAt: options.archived ? new Date() : null,
        });
        if (options.reviewed) {
          await connection.db.insert(approvalRuns).values({
            sheetId: id,
            runNumber: 1,
            status: "APPROVED",
            reviewedDataFingerprint: "0".repeat(64),
            submittedByUserId: cutManager.id,
            completedAt: new Date(),
          });
        }
        return id;
      }
      const as = (who: { cookie: string; csrf: string }) => ({ origin: appOrigin, cookie: who.cookie, "x-csrf-token": who.csrf });
      const detail = async (who: { cookie: string }, sheetId: string) => {
        const response = await app.inject({ method: "GET", url: `/api/sheets/${sheetId}`, headers: { cookie: who.cookie } });
        expect(response.statusCode).toBe(200);
        return response.json().sheet.rowMarks as { sectionKey: string; marked: number[]; canMark: boolean } | null;
      };
      const mark = (who: { cookie: string; csrf: string }, sheetId: string, body: Record<string, unknown>) =>
        app.inject({
          method: "POST",
          url: `/api/sheets/${sheetId}/row-marks`,
          headers: as(who),
          payload: { clientMutationId: randomUUID(), sectionKey: "items", rowIndex: 0, marked: true, ...body },
        });

      // Arrived in 分條 with its review done: 分條's 主管 ticks.
      const arrived = await sheet({ departmentId: slittingId, reviewed: true });
      expect(await detail(manager, arrived)).toEqual({ sectionKey: "items", marked: [], canMark: true });
      const tickId = randomUUID();
      const ticked = await mark(manager, arrived, { clientMutationId: tickId, rowIndex: 2 });
      expect(ticked.statusCode).toBe(200);
      expect(ticked.json().result).toMatchObject({ action: "SET_ROW_MARK", rowIndex: 2, marked: true, replayed: false });
      // The same request again is replayed, not applied twice.
      const replay = await mark(manager, arrived, { clientMutationId: tickId, rowIndex: 2 });
      expect(replay.json().result).toMatchObject({ rowIndex: 2, replayed: true });
      expect((await mark(manager, arrived, { rowIndex: 5 })).statusCode).toBe(200);
      expect(await detail(manager, arrived)).toEqual({ sectionKey: "items", marked: [2, 5], canMark: true });
      const [audit] = await connection.db.select().from(auditEvents)
        .where(and(eq(auditEvents.targetId, arrived), eq(auditEvents.action, "SHEET_ROW_MARK_SET")))
        .orderBy(desc(auditEvents.createdAt)).limit(1);
      expect(audit?.metadata).toMatchObject({ sectionKey: "items", rowIndex: 5, marked: true });

      // 分條's 員工 sees the ticks but may not change them.
      expect(await detail(staff, arrived)).toEqual({ sectionKey: "items", marked: [2, 5], canMark: false });
      expect((await mark(staff, arrived, { rowIndex: 3 })).statusCode).toBe(403);

      // Unticking removes it; rows past the form's eight, or another section, are refused.
      expect((await mark(manager, arrived, { rowIndex: 2, marked: false })).statusCode).toBe(200);
      expect((await detail(manager, arrived))?.marked).toEqual([5]);
      expect((await mark(manager, arrived, { rowIndex: 8 })).statusCode).toBe(409);
      expect((await mark(manager, arrived, { sectionKey: "header" })).statusCode).toBe(409);

      // In 分條 but still under review: no ticks yet.
      const underReview = await sheet({ departmentId: slittingId, reviewed: false });
      expect(await detail(manager, underReview)).toBeNull();
      expect((await mark(manager, underReview, {})).statusCode).toBe(409);

      // Still in the department that wrote it: no ticks there.
      const notSent = await sheet({ departmentId: cutId, reviewed: true });
      expect(await detail(cutManager, notSent)).toBeNull();
      expect((await mark(cutManager, notSent, {})).statusCode).toBe(409);

      // Archived: the ticks show but are fixed.
      const archived = await sheet({ departmentId: slittingId, reviewed: true, archived: true });
      expect(await detail(manager, archived)).toEqual({ sectionKey: "items", marked: [], canMark: false });
      expect((await mark(manager, archived, {})).statusCode).toBe(409);
    } finally {
      await app.close();
      if (sheetIds.length > 0) {
        await connection.db.delete(sheetRowMarks).where(inArray(sheetRowMarks.sheetId, sheetIds));
        await connection.db.delete(sheetClientMutations).where(inArray(sheetClientMutations.sheetId, sheetIds));
        await connection.db.delete(auditEvents).where(inArray(auditEvents.targetId, sheetIds));
        await connection.db.delete(productionSheets).where(inArray(productionSheets.id, sheetIds));
      }
      if (subpageId) await connection.db.delete(departmentSubpages).where(eq(departmentSubpages.id, subpageId));
      if (userIds.length > 0) {
        await connection.db.delete(auditEvents).where(inArray(auditEvents.actorUserId, userIds));
        await connection.db.delete(users).where(inArray(users.id, userIds));
      }
      await connection.close();
    }
  }, 30_000);
});
