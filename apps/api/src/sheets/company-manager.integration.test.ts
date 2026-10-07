import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  auditEvents,
  createDatabase,
  departmentMemberships,
  departmentSubpageMutations,
  departmentSubpages,
  departments,
  outboxJobs,
  productionSheets,
  roleAssignments,
  sheetTemplates,
  users,
} from "@workflow/database";
import type { RoleCode } from "@workflow/contracts";
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
 * ADMIN and 總經理 hold a 主管's authority in every department and subpage
 * (the user, 2026-09-30) without belonging to any: they create, edit, move and
 * read rosters there. Form ticks and the template's origin departments still
 * bind them. 協理 reads everything and manages nothing.
 */
describe.skipIf(!testDatabaseUrl)("company-wide managers", () => {
  it("create and run sheets in any department, within form ticks and origin rules", async () => {
    const connection = createDatabase(testDatabaseUrl!, 1);
    const suffix = randomUUID().slice(0, 8);
    const password = `CompanyManager-${suffix}-Password!`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const userIds: string[] = [];
    const subpageIds: string[] = [];
    const sheetIds: string[] = [];
    const mutationIds: string[] = [];
    const mutation = () => {
      const id = randomUUID();
      mutationIds.push(id);
      return id;
    };
    const app = await buildApp(loadConfig({ DATABASE_URL: testDatabaseUrl, NODE_ENV: "test", APP_ORIGIN: appOrigin }));

    try {
      const [cut] = await connection.db.select({ id: departments.id }).from(departments).where(eq(departments.code, "CUT"));
      const [slitting] = await connection.db.select({ id: departments.id }).from(departments).where(eq(departments.code, "SLITTING"));
      const cutId = cut!.id;
      const slittingId = slitting!.id;
      const [board] = await connection.db.select({ id: sheetTemplates.id, displayName: sheetTemplates.displayName }).from(sheetTemplates)
        .where(and(eq(sheetTemplates.departmentId, cutId), eq(sheetTemplates.slug, "cut-production-board")));
      const boardId = board!.id;

      async function person(label: string, options: { role?: RoleCode; manages?: string }) {
        const [user] = await connection.db.insert(users).values({
          username: `company-manager-${label}-${suffix}`,
          displayName: `公司主管測試 ${label}`,
          passwordHash,
        }).returning({ id: users.id, username: users.username });
        if (!user) throw new Error("Failed to create user");
        userIds.push(user.id);
        if (options.role) await connection.db.insert(roleAssignments).values({ userId: user.id, role: options.role });
        if (options.manages) await connection.db.insert(departmentMemberships).values({ userId: user.id, departmentId: options.manages, kind: "MANAGER" });
        const login = await app.inject({ method: "POST", url: "/api/auth/login", headers: { origin: appOrigin }, payload: { username: user.username, password } });
        expect(login.statusCode).toBe(200);
        return { ...user, ...cookies(login) };
      }
      const cutManager = await person("cut-manager", { manages: cutId });
      // Neither belongs to any department.
      const admin = await person("admin", { role: "ADMIN" });
      const generalManager = await person("gm", { role: "GENERAL_MANAGER" });
      const associate = await person("associate", { role: "ASSOCIATE" });

      const as = (who: { cookie: string; csrf: string }) => ({ origin: appOrigin, cookie: who.cookie, "x-csrf-token": who.csrf });
      async function subpage(name: string, departmentId: string, owner: { cookie: string; csrf: string }, templateIds: string[]) {
        const created = await app.inject({ method: "POST", url: `/api/departments/${departmentId}/subpages`, headers: as(owner), payload: { clientMutationId: mutation(), name: `${name} ${suffix}` } });
        expect(created.statusCode).toBe(201);
        const id = created.json().result.subpageId as string;
        subpageIds.push(id);
        // No identity grants at all: only 主管 authority can act here.
        if (templateIds.length > 0) {
          const ticked = await app.inject({ method: "PUT", url: `/api/departments/${departmentId}/subpages/${id}/templates`, headers: as(owner), payload: { clientMutationId: mutation(), revision: 1, templateIds } });
          expect(ticked.statusCode).toBe(200);
        }
        return id;
      }
      const create = (who: { cookie: string; csrf: string }, subpageId: string, originDepartmentId = cutId) =>
        app.inject({ method: "POST", url: "/api/sheets", headers: as(who), payload: { clientMutationId: mutation(), templateId: boardId, originDepartmentId, subpageId } });
      const capabilities = async (who: { cookie: string }, subpageId: string) => {
        const response = await app.inject({ method: "GET", url: `/api/departments/${cutId}/subpages`, headers: { cookie: who.cookie } });
        expect(response.statusCode).toBe(200);
        return (response.json().subpages as { id: string; capabilities: Record<string, boolean> }[]).find((item) => item.id === subpageId)?.capabilities;
      };

      const ticked = await subpage("公司主管區", cutId, cutManager, [boardId]);
      const unticked = await subpage("未勾選區", cutId, cutManager, []);

      for (const who of [admin, generalManager]) {
        expect(await capabilities(who, ticked)).toEqual({ canView: true, canCreate: true, canEdit: true, canSubmit: true });
        const created = await create(who, ticked);
        expect(created.statusCode).toBe(201);
        const sheetId = created.json().sheet.id as string;
        sheetIds.push(sheetId);
        const detail = await app.inject({ method: "GET", url: `/api/sheets/${sheetId}`, headers: { cookie: who.cookie } });
        expect(detail.json().sheet).toMatchObject({ subpageId: ticked, permissions: { canEdit: true, canSubmit: true } });
        const edited = await app.inject({ method: "PATCH", url: `/api/sheets/${sheetId}/values`, headers: as(who), payload: { baseVersion: detail.json().sheet.version, clientMutationId: mutation(), changes: [{ fieldKey: "board.0.process", value: "(1)" }] } });
        expect(edited.statusCode).toBe(200);
        // Roster for assigning, as the department's 主管 has.
        const roster = await app.inject({ method: "GET", url: `/api/departments/${cutId}/staff`, headers: { cookie: who.cookie } });
        expect(roster.statusCode).toBe(200);
        // Form ticks still bind them.
        expect((await create(who, unticked)).statusCode).toBe(403);
        // The list names each sheet by its form, which the screens show in
        // place of the sheet number.
        const listed = await app.inject({ method: "GET", url: `/api/sheets?departmentId=${cutId}&subpageId=${ticked}`, headers: { cookie: who.cookie } });
        expect(listed.statusCode).toBe(200);
        expect(listed.json().sheets).toContainEqual(expect.objectContaining({ id: sheetId, templateName: board!.displayName }));
      }

      // So does the template's list of origin departments: 分條 may not
      // create this CUT form, even for ADMIN.
      const slittingArea = await subpage("分條區", slittingId, admin, []);
      expect((await create(admin, slittingArea, slittingId)).statusCode).toBe(403);

      // 總經理 moves a sheet between subpages, as a 主管 does.
      const moved = await app.inject({ method: "GET", url: `/api/sheets/${sheetIds[0]}`, headers: { cookie: generalManager.cookie } });
      const second = await subpage("第二區", cutId, cutManager, [boardId]);
      const move = await app.inject({ method: "POST", url: `/api/sheets/${sheetIds[0]}/subpage`, headers: as(generalManager), payload: { clientMutationId: mutation(), baseVersion: moved.json().sheet.version, subpageId: second } });
      expect(move.statusCode).toBe(200);

      // 協理 reads everything and manages nothing.
      expect(await capabilities(associate, ticked)).toEqual({ canView: true, canCreate: false, canEdit: false, canSubmit: false });
      expect((await create(associate, ticked)).statusCode).toBe(403);
      const associateRoster = await app.inject({ method: "GET", url: `/api/departments/${cutId}/staff`, headers: { cookie: associate.cookie } });
      expect(associateRoster.statusCode).toBe(403);
    } finally {
      await app.close();
      if (sheetIds.length > 0) await connection.db.delete(productionSheets).where(inArray(productionSheets.id, sheetIds));
      if (mutationIds.length > 0) {
        await connection.db.delete(outboxJobs).where(or(...mutationIds.map((id) => like(outboxJobs.deduplicationKey, `${id}:%`))));
      }
      if (userIds.length > 0) {
        await connection.db.delete(departmentSubpageMutations).where(inArray(departmentSubpageMutations.actorUserId, userIds));
        await connection.db.delete(auditEvents).where(inArray(auditEvents.actorUserId, userIds));
        await connection.db.delete(users).where(inArray(users.id, userIds));
      }
      if (subpageIds.length > 0) await connection.db.delete(departmentSubpages).where(inArray(departmentSubpages.id, subpageIds));
      await connection.close();
    }
  }, 30_000);
});
