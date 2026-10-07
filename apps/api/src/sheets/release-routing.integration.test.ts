import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { and, asc, eq, inArray, like, or } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  auditEvents,
  createDatabase,
  departmentMemberships,
  departmentSubpageMutations,
  departmentSubpageTemplates,
  departmentSubpages,
  departments,
  outboxJobs,
  productionSheets,
  sheetHandoffs,
  sheetSubpageHistory,
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
 * 退火明細表 has no review and its workflow leads to 燒頓: CUT writes it, and
 * handing it on sends it straight to 燒頓's 待分派, as a handoff would (the
 * user, 2026-09-27).
 */
describe.skipIf(!testDatabaseUrl)("release routing", () => {
  it("sends a review-free form on to its workflow's department when it is handed on", async () => {
    const connection = createDatabase(testDatabaseUrl!, 1);
    const suffix = randomUUID().slice(0, 8);
    const password = `Routing-${suffix}-Password!`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const userIds: string[] = [];
    const subpageIds: string[] = [];
    const mutationIds: string[] = [];
    // Every mutation is recorded so cleanup removes what it queued.
    const mutation = () => {
      const id = randomUUID();
      mutationIds.push(id);
      return id;
    };
    let sheetId: string | null = null;
    const app = await buildApp(loadConfig({ DATABASE_URL: testDatabaseUrl, NODE_ENV: "test", APP_ORIGIN: appOrigin }));

    try {
      const departmentRows = await connection.db
        .select({ id: departments.id, code: departments.code })
        .from(departments)
        .where(inArray(departments.code, ["CUT", "SHAO_DUN"]));
      const cutId = departmentRows.find((row) => row.code === "CUT")!.id;
      const shaoDunId = departmentRows.find((row) => row.code === "SHAO_DUN")!.id;
      const [annealing] = await connection.db
        .select({ id: sheetTemplates.id })
        .from(sheetTemplates)
        .where(and(eq(sheetTemplates.departmentId, cutId), eq(sheetTemplates.slug, "cut-annealing-list")));
      const annealingId = annealing!.id;

      async function identity(label: string, departmentId: string, kinds: ("MANAGER" | "ORDER_TAKER" | "STAFF")[]) {
        const [user] = await connection.db.insert(users).values({
          username: `routing-${label}-${suffix}`,
          displayName: `轉送測試 ${label}`,
          passwordHash,
        }).returning({ id: users.id, username: users.username });
        if (!user) throw new Error("Failed to create identity");
        userIds.push(user.id);
        await connection.db.insert(departmentMemberships).values(kinds.map((kind) => ({ userId: user.id, departmentId, kind })));
        const login = await app.inject({ method: "POST", url: "/api/auth/login", headers: { origin: appOrigin }, payload: { username: user.username, password } });
        expect(login.statusCode).toBe(200);
        return { ...user, ...cookies(login) };
      }
      const as = (who: { cookie: string; csrf: string }) => ({ origin: appOrigin, cookie: who.cookie, "x-csrf-token": who.csrf });

      const cutManager = await identity("cut-manager", cutId, ["MANAGER"]);
      const cutMember = await identity("cut-member", cutId, ["ORDER_TAKER", "STAFF"]);
      const shaoDunManager = await identity("shaodun-manager", shaoDunId, ["MANAGER"]);
      const shaoDunStaff = await identity("shaodun-staff", shaoDunId, ["STAFF"]);

      async function subpage(departmentId: string, owner: { cookie: string; csrf: string }, name: string) {
        const created = await app.inject({ method: "POST", url: `/api/departments/${departmentId}/subpages`, headers: as(owner), payload: { clientMutationId: mutation(), name: `${name} ${suffix}` } });
        expect(created.statusCode).toBe(201);
        const id = created.json().result.subpageId as string;
        subpageIds.push(id);
        const everything = { canView: true, canCreate: true, canEdit: true, canSubmit: true };
        const granted = await app.inject({ method: "PUT", url: `/api/departments/${departmentId}/subpages/${id}/identities`, headers: as(owner), payload: { clientMutationId: mutation(), revision: 1, permissions: [{ kind: "STAFF", ...everything }, { kind: "ORDER_TAKER", ...everything }] } });
        expect(granted.statusCode).toBe(200);
        return id;
      }
      const cutSubpage = await subpage(cutId, cutManager, "退火區");
      await connection.db.insert(departmentSubpageTemplates).values({ subpageId: cutSubpage, templateId: annealingId });

      // CUT writes the list.
      const created = await app.inject({ method: "POST", url: "/api/sheets", headers: as(cutMember), payload: { clientMutationId: mutation(), templateId: annealingId, originDepartmentId: cutId, subpageId: cutSubpage } });
      expect(created.statusCode).toBe(201);
      sheetId = created.json().sheet.id as string;
      const draft = await app.inject({ method: "GET", url: `/api/sheets/${sheetId}`, headers: { cookie: cutMember.cookie } });
      // It starts at 待生產, and the page names where sending it on takes it.
      expect(draft.json().sheet.state).toBe("READY");
      expect(draft.json().sheet.releaseDestination).toEqual({ code: "SHAO_DUN", displayName: "燒頓" });
      // Its status is 燒頓's to set, not CUT's.
      const cutStatus = await app.inject({ method: "POST", url: `/api/sheets/${sheetId}/status`, headers: as(cutMember), payload: { clientMutationId: mutation(), baseVersion: draft.json().sheet.version, state: "IN_PROGRESS" } });
      expect(cutStatus.statusCode).toBe(409);
      const written = await app.inject({ method: "PATCH", url: `/api/sheets/${sheetId}/values`, headers: as(cutMember), payload: { baseVersion: draft.json().sheet.version, clientMutationId: mutation(), changes: [{ fieldKey: "orders.0.workOrderNo", value: "W-1" }] } });
      expect(written.statusCode).toBe(200);

      // Handing it on sends it to 燒頓.
      const submitted = await app.inject({ method: "POST", url: `/api/sheets/${sheetId}/submit`, headers: as(cutMember), payload: { clientMutationId: mutation() } });
      expect(submitted.statusCode).toBe(200);
      expect(submitted.json().result).toMatchObject({
        state: "READY",
        routedTo: { departmentId: shaoDunId, displayName: "燒頓" },
      });
      const [moved] = await connection.db
        .select({ currentDepartmentId: productionSheets.currentDepartmentId, subpageId: productionSheets.subpageId, state: productionSheets.state })
        .from(productionSheets)
        .where(eq(productionSheets.id, sheetId));
      // In 燒頓's 待分派: no subpage yet.
      expect(moved).toEqual({ currentDepartmentId: shaoDunId, subpageId: null, state: "READY" });
      const handoffs = await connection.db.select().from(sheetHandoffs).where(eq(sheetHandoffs.sheetId, sheetId));
      expect(handoffs).toHaveLength(1);
      expect(handoffs[0]).toMatchObject({ sourceDepartmentId: cutId, destinationDepartmentId: shaoDunId, note: "送交後自動送至燒頓部門" });
      const history = await connection.db.select().from(sheetSubpageHistory).where(eq(sheetSubpageHistory.sheetId, sheetId)).orderBy(asc(sheetSubpageHistory.createdAt));
      expect(history.at(-1)).toMatchObject({ fromSubpageId: cutSubpage, toDepartmentId: shaoDunId, toSubpageId: null, reason: "HANDOFF_PENDING" });

      // CUT's member no longer reaches it; 燒頓's 主管 does, and it now stays put.
      const cutView = await app.inject({ method: "GET", url: `/api/sheets/${sheetId}`, headers: { cookie: cutMember.cookie } });
      expect(cutView.statusCode).toBe(403);
      const shaoDunView = await app.inject({ method: "GET", url: `/api/sheets/${sheetId}`, headers: { cookie: shaoDunManager.cookie } });
      expect(shaoDunView.statusCode).toBe(200);
      expect(shaoDunView.json().sheet.releaseDestination).toBeNull();

      // 燒頓's 主管 places it in a subpage, and whoever may modify it there
      // starts it and records the firing; nobody is assigned. The form is not
      // one 燒頓 can tick, so its subpage ticks do not stand in the way.
      const shaoDunSubpage = await subpage(shaoDunId, shaoDunManager, "爐區");
      const unplaced = await app.inject({ method: "POST", url: `/api/sheets/${sheetId}/status`, headers: as(shaoDunManager), payload: { clientMutationId: mutation(), baseVersion: shaoDunView.json().sheet.version, state: "IN_PROGRESS" } });
      expect(unplaced.statusCode).toBe(409);
      const placed = await app.inject({ method: "POST", url: `/api/sheets/${sheetId}/subpage`, headers: as(shaoDunManager), payload: { clientMutationId: mutation(), baseVersion: shaoDunView.json().sheet.version, subpageId: shaoDunSubpage } });
      expect(placed.statusCode).toBe(200);
      // 燒頓 sets it to 生產中 and records the firing.
      const started = await app.inject({ method: "POST", url: `/api/sheets/${sheetId}/status`, headers: as(shaoDunStaff), payload: { clientMutationId: mutation(), baseVersion: placed.json().result.version, state: "IN_PROGRESS" } });
      expect(started.statusCode).toBe(200);
      expect(started.json().result.state).toBe("IN_PROGRESS");
      const startedView = await app.inject({ method: "GET", url: `/api/sheets/${sheetId}`, headers: { cookie: shaoDunStaff.cookie } });
      expect(startedView.statusCode).toBe(200);
      const fired = await app.inject({ method: "PATCH", url: `/api/sheets/${sheetId}/values`, headers: as(shaoDunStaff), payload: { baseVersion: startedView.json().sheet.version, clientMutationId: mutation(), changes: [{ fieldKey: "furnaceNo", value: "2" }] } });
      expect(fired.statusCode).toBe(200);
    } finally {
      await app.close();
      if (sheetId) await connection.db.delete(productionSheets).where(eq(productionSheets.id, sheetId));
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
