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
  sheetTemplates,
  users,
} from "@workflow/database";
import type { MembershipKind } from "@workflow/contracts";
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
 * GET /api/sheets decides readability for the whole list in SQL. It must
 * agree with the per-sheet check behind GET /api/sheets/:id: outside the
 * company-wide readers and the department's 主管, a sheet is listed only when
 * its current subpage grants one of the user's active identities 查看.
 */
describe.skipIf(!testDatabaseUrl)("sheet list visibility", () => {
  it("lists a sheet only to users its current subpage lets view it", async () => {
    const connection = createDatabase(testDatabaseUrl!, 1);
    const suffix = randomUUID().slice(0, 8);
    const password = `ListVisibility-${suffix}-Password!`;
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

      async function person(label: string, kinds: MembershipKind[], departmentId = cutId) {
        const [user] = await connection.db.insert(users).values({
          username: `list-visibility-${label}-${suffix}`,
          displayName: `列表可見測試 ${label}`,
          passwordHash,
        }).returning({ id: users.id, username: users.username });
        if (!user) throw new Error("Failed to create user");
        userIds.push(user.id);
        if (kinds.length > 0) {
          await connection.db.insert(departmentMemberships).values(kinds.map((kind) => ({ userId: user.id, departmentId, kind })));
        }
        const login = await app.inject({ method: "POST", url: "/api/auth/login", headers: { origin: appOrigin }, payload: { username: user.username, password } });
        expect(login.statusCode).toBe(200);
        return { ...user, ...cookies(login) };
      }
      const manager = await person("manager", ["MANAGER"]);
      const staff = await person("staff", ["STAFF"]);
      const orderTaker = await person("order-taker", ["ORDER_TAKER"]);
      const otherManager = await person("other-manager", ["MANAGER"], slittingId);

      const as = (who: { cookie: string; csrf: string }) => ({ origin: appOrigin, cookie: who.cookie, "x-csrf-token": who.csrf });
      const created = await app.inject({ method: "POST", url: `/api/departments/${cutId}/subpages`, headers: as(manager), payload: { clientMutationId: mutation(), name: `列表可見 ${suffix}` } });
      expect(created.statusCode).toBe(201);
      const subpageId = created.json().result.subpageId as string;
      subpageIds.push(subpageId);
      let revision = 1;
      const ticked = await app.inject({ method: "PUT", url: `/api/departments/${cutId}/subpages/${subpageId}/templates`, headers: as(manager), payload: { clientMutationId: mutation(), revision, templateIds: [boardId] } });
      expect(ticked.statusCode).toBe(200);
      revision += 1;

      const sheet = await app.inject({ method: "POST", url: "/api/sheets", headers: as(manager), payload: { clientMutationId: mutation(), templateId: boardId, originDepartmentId: cutId, subpageId } });
      expect(sheet.statusCode).toBe(201);
      const sheetId = sheet.json().sheet.id as string;
      sheetIds.push(sheetId);

      const listed = async (who: { cookie: string }, query = "") => {
        const response = await app.inject({ method: "GET", url: `/api/sheets${query}`, headers: { cookie: who.cookie } });
        expect(response.statusCode).toBe(200);
        return (response.json().sheets as { id: string }[]).filter((item) => sheetIds.includes(item.id));
      };
      const readable = async (who: { cookie: string }) =>
        (await app.inject({ method: "GET", url: `/api/sheets/${sheetId}`, headers: { cookie: who.cookie } })).statusCode;
      async function grant(permissions: { kind: "ORDER_TAKER" | "STAFF"; canView: boolean }[]) {
        const response = await app.inject({
          method: "PUT",
          url: `/api/departments/${cutId}/subpages/${subpageId}/identities`,
          headers: as(manager),
          payload: {
            clientMutationId: mutation(),
            revision,
            permissions: permissions.map((permission) => ({ ...permission, canCreate: false, canEdit: false, canSubmit: false })),
          },
        });
        expect(response.statusCode).toBe(200);
        revision += 1;
      }

      // The department's 主管 sees it, with its form's name.
      expect(await listed(manager)).toEqual([expect.objectContaining({ id: sheetId, templateName: board!.displayName, subpageId, currentDepartmentId: cutId })]);
      // Membership alone grants nothing, and another department's 主管 has no
      // say here.
      for (const who of [staff, orderTaker, otherManager]) {
        expect(await listed(who)).toEqual([]);
        expect(await readable(who)).toBe(403);
      }

      // 查看 for 員工 lets the 員工 see it, and only them.
      await grant([{ kind: "STAFF", canView: true }, { kind: "ORDER_TAKER", canView: false }]);
      expect(await listed(staff)).toEqual([expect.objectContaining({ id: sheetId, templateName: board!.displayName })]);
      expect(await readable(staff)).toBe(200);
      for (const who of [orderTaker, otherManager]) {
        expect(await listed(who)).toEqual([]);
        expect(await readable(who)).toBe(403);
      }

      // Filters run alongside the permission condition.
      expect(await listed(staff, `?departmentId=${cutId}&subpageId=${subpageId}`)).toHaveLength(1);
      expect(await listed(staff, `?departmentId=${slittingId}`)).toEqual([]);
      const state = sheet.json().sheet.state as string;
      expect(await listed(staff, `?state=${state}`)).toHaveLength(1);
      expect(await listed(staff, `?state=${state === "COMPLETED" ? "IN_PROGRESS" : "COMPLETED"}`)).toEqual([]);

      // An inactive identity no longer counts.
      await connection.db.update(departmentMemberships).set({ active: false })
        .where(and(eq(departmentMemberships.userId, staff.id), eq(departmentMemberships.departmentId, cutId)));
      expect(await listed(staff)).toEqual([]);
      await connection.db.update(departmentMemberships).set({ active: true })
        .where(and(eq(departmentMemberships.userId, staff.id), eq(departmentMemberships.departmentId, cutId)));

      // Withdrawing 查看 hides it again.
      await grant([{ kind: "STAFF", canView: false }, { kind: "ORDER_TAKER", canView: true }]);
      expect(await listed(staff)).toEqual([]);
      expect(await readable(staff)).toBe(403);
      expect(await listed(orderTaker)).toHaveLength(1);
      expect(await readable(orderTaker)).toBe(200);
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
