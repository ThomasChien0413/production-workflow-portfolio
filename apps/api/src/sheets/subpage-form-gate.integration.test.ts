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
 * A subpage's form ticks decide what may be created there, what may be moved
 * into it, and what anyone but its 主管 may use there (the user's
 * decision, 2026-09-24). Unticking a form leaves its sheets readable; the
 * 主管 keeps full control so the work can be moved somewhere that allows it.
 * A form handed in from a department that created it, and which the receiving
 * department cannot tick, is left to the identity grants alone.
 */
describe.skipIf(!testDatabaseUrl)("subpage form ticks", () => {
  it("govern creating and moving in, and using a sheet", async () => {
    const connection = createDatabase(testDatabaseUrl!, 1);
    const suffix = randomUUID().slice(0, 8);
    const password = `FormGate-${suffix}-Password!`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const userIds: string[] = [];
    const subpageIds: string[] = [];
    const mutationIds: string[] = [];
    // Every mutation is recorded so cleanup removes the notifications it queued;
    // a leftover pending job would be claimed by the next file's outbox test.
    const mutation = () => {
      const id = randomUUID();
      mutationIds.push(id);
      return id;
    };
    let sheetId: string | null = null;
    const app = await buildApp(loadConfig({ DATABASE_URL: testDatabaseUrl, NODE_ENV: "test", APP_ORIGIN: appOrigin }));

    try {
      const [cut] = await connection.db.select({ id: departments.id }).from(departments).where(eq(departments.code, "CUT"));
      const cutId = cut!.id;
      const [board] = await connection.db.select({ id: sheetTemplates.id }).from(sheetTemplates)
        .where(and(eq(sheetTemplates.departmentId, cutId), eq(sheetTemplates.slug, "cut-production-board")));
      const boardId = board!.id;

      async function identity(label: string, kinds: ("MANAGER" | "ORDER_TAKER" | "STAFF")[], departmentId = cutId) {
        const [user] = await connection.db.insert(users).values({
          username: `form-gate-${label}-${suffix}`,
          displayName: `表單勾選測試 ${label}`,
          passwordHash,
        }).returning({ id: users.id, username: users.username });
        if (!user) throw new Error("Failed to create identity");
        userIds.push(user.id);
        await connection.db.insert(departmentMemberships).values(kinds.map((kind) => ({ userId: user.id, departmentId, kind })));
        const login = await app.inject({ method: "POST", url: "/api/auth/login", headers: { origin: appOrigin }, payload: { username: user.username, password } });
        expect(login.statusCode).toBe(200);
        return { ...user, ...cookies(login) };
      }
      const manager = await identity("manager", ["MANAGER"]);
      const member = await identity("member", ["ORDER_TAKER", "STAFF"]);

      const as = (who: { cookie: string; csrf: string }) => ({ origin: appOrigin, cookie: who.cookie, "x-csrf-token": who.csrf });
      const revisions = new Map<string, number>();

      async function subpage(name: string, departmentId = cutId, owner: { cookie: string; csrf: string } = manager) {
        const created = await app.inject({ method: "POST", url: `/api/departments/${departmentId}/subpages`, headers: as(owner), payload: { clientMutationId: mutation(), name: `${name} ${suffix}` } });
        expect(created.statusCode).toBe(201);
        const id = created.json().result.subpageId as string;
        subpageIds.push(id);
        revisions.set(id, 1);
        // Both identities may do everything here: only the form ticks differ.
        const everything = { canView: true, canCreate: true, canEdit: true, canSubmit: true };
        const granted = await app.inject({ method: "PUT", url: `/api/departments/${departmentId}/subpages/${id}/identities`, headers: as(owner), payload: { clientMutationId: mutation(), revision: 1, permissions: [{ kind: "STAFF", ...everything }, { kind: "ORDER_TAKER", ...everything }] } });
        expect(granted.statusCode).toBe(200);
        revisions.set(id, 2);
        return id;
      }
      async function tick(subpageId: string, templateIds: string[]) {
        const revision = revisions.get(subpageId)!;
        const response = await app.inject({ method: "PUT", url: `/api/departments/${cutId}/subpages/${subpageId}/templates`, headers: as(manager), payload: { clientMutationId: mutation(), revision, templateIds } });
        expect(response.statusCode).toBe(200);
        revisions.set(subpageId, revision + 1);
      }
      const detail = async (who: { cookie: string }) => {
        const response = await app.inject({ method: "GET", url: `/api/sheets/${sheetId}`, headers: { cookie: who.cookie } });
        expect(response.statusCode).toBe(200);
        return response.json().sheet as { version: number; formEnabledInSubpage: boolean; permissions: { canEdit: boolean; canSubmit: boolean } };
      };
      const patch = async (who: { cookie: string; csrf: string }, value: string) => {
        const { version } = await detail(manager);
        return app.inject({ method: "PATCH", url: `/api/sheets/${sheetId}/values`, headers: as(who), payload: { baseVersion: version, clientMutationId: mutation(), changes: [{ fieldKey: "board.0.process", value }] } });
      };
      const move = async (to: string) => {
        const { version } = await detail(manager);
        return app.inject({ method: "POST", url: `/api/sheets/${sheetId}/subpage`, headers: as(manager), payload: { clientMutationId: mutation(), baseVersion: version, subpageId: to } });
      };

      const allowing = await subpage("看板區");
      const other = await subpage("其他區");
      await tick(allowing, [boardId]);

      // Created only where the form is ticked.
      const refused = await app.inject({ method: "POST", url: "/api/sheets", headers: as(member), payload: { clientMutationId: mutation(), templateId: boardId, originDepartmentId: cutId, subpageId: other } });
      expect(refused.statusCode).toBe(403);
      const created = await app.inject({ method: "POST", url: "/api/sheets", headers: as(member), payload: { clientMutationId: mutation(), templateId: boardId, originDepartmentId: cutId, subpageId: allowing } });
      expect(created.statusCode).toBe(201);
      sheetId = created.json().sheet.id as string;
      expect(await detail(member)).toMatchObject({ formEnabledInSubpage: true, permissions: { canEdit: true, canSubmit: true } });
      expect((await patch(member, "(1)")).statusCode).toBe(200);

      // Not moved into a subpage that does not allow the form.
      expect((await move(other)).statusCode).toBe(409);

      // Unticked where it already is: readable, but no longer usable by
      // anyone but the 主管.
      await tick(allowing, []);
      expect(await detail(member)).toMatchObject({ formEnabledInSubpage: false, permissions: { canEdit: false, canSubmit: false } });
      expect((await patch(member, "(2)")).statusCode).toBe(403);
      const memberSubmit = await app.inject({ method: "POST", url: `/api/sheets/${sheetId}/submit`, headers: as(member), payload: { clientMutationId: mutation() } });
      expect(memberSubmit.statusCode).toBe(403);
      expect((await patch(manager, "(2)")).statusCode).toBe(200);

      // The 主管 moves it somewhere that allows the form, and it is usable again.
      await tick(other, [boardId]);
      expect((await move(other)).statusCode).toBe(200);
      expect(await detail(member)).toMatchObject({ formEnabledInSubpage: true, permissions: { canEdit: true } });

      // It has been at 待生產 since it was created; there is nothing to send.
      // Whoever may modify it in its subpage sets its status, but not while
      // the subpage has stopped allowing the form.
      const status = async (who: { cookie: string; csrf: string }, state: string) => {
        const { version } = await detail(manager);
        return app.inject({ method: "POST", url: `/api/sheets/${sheetId}/status`, headers: as(who), payload: { clientMutationId: mutation(), baseVersion: version, state } });
      };
      const nothingToSend = await app.inject({ method: "POST", url: `/api/sheets/${sheetId}/submit`, headers: as(member), payload: { clientMutationId: mutation() } });
      expect(nothingToSend.statusCode).toBe(409);
      await tick(other, []);
      expect((await status(member, "IN_PROGRESS")).statusCode).toBe(403);
      await tick(other, [boardId]);
      expect((await status(member, "IN_PROGRESS")).statusCode).toBe(200);
      // In any order: completed, back to 生產中, then completed again.
      expect((await status(member, "COMPLETED")).statusCode).toBe(200);
      expect((await status(member, "IN_PROGRESS")).statusCode).toBe(200);
      expect((await status(member, "IN_PROGRESS")).statusCode).toBe(409);
      expect((await status(member, "COMPLETED")).statusCode).toBe(200);

      // Finished, it is archived where it is, and its 主管 may bring it back
      // to the same subpage as 已完成 (the user, 2026-10-04).
      const lifecycle = (action: "archive" | "restore", who: { cookie: string; csrf: string }, clientMutationId = mutation()) =>
        app.inject({ method: "POST", url: `/api/sheets/${sheetId}/${action}`, headers: as(who), payload: { clientMutationId } });
      expect((await lifecycle("archive", member)).statusCode).toBe(403);
      expect((await lifecycle("restore", manager)).statusCode).toBe(409);
      expect((await lifecycle("archive", manager)).statusCode).toBe(200);
      const [archived] = await connection.db.select().from(productionSheets).where(eq(productionSheets.id, sheetId));
      expect(archived).toMatchObject({ state: "ARCHIVED", subpageId: other });
      expect(archived!.archivedAt).toBeInstanceOf(Date);
      expect((await status(member, "IN_PROGRESS")).statusCode).toBe(409);
      expect((await lifecycle("restore", member)).statusCode).toBe(403);
      const restoreMutation = mutation();
      const restored = await lifecycle("restore", manager, restoreMutation);
      expect(restored.statusCode).toBe(200);
      expect(restored.json().result).toMatchObject({ action: "RESTORE", state: "COMPLETED", subpageId: other, version: archived!.version + 1 });
      const replayed = await lifecycle("restore", manager, restoreMutation);
      expect(replayed.json().result).toMatchObject({ ...restored.json().result, replayed: true });
      expect((await lifecycle("restore", manager)).statusCode).toBe(409);
      const [back] = await connection.db.select().from(productionSheets).where(eq(productionSheets.id, sheetId));
      expect(back).toMatchObject({ state: "COMPLETED", subpageId: other, archivedAt: null });
      expect(back!.completedAt).toEqual(archived!.completedAt);
      const [restoreAudit] = await connection.db.select().from(auditEvents).where(and(eq(auditEvents.targetId, sheetId), eq(auditEvents.action, "SHEET_RESTORED")));
      expect(restoreAudit).toMatchObject({ actorUserId: manager.id });
      // Back in its subpage it is worked on as before.
      expect((await status(member, "IN_PROGRESS")).statusCode).toBe(200);

      // An archived sheet may be deleted at once by its 主管 (the user,
      // 2026-10-04); nothing else is ever deleted.
      const remove = (who: { cookie: string; csrf: string }, clientMutationId = mutation()) =>
        app.inject({ method: "POST", url: `/api/sheets/${sheetId}/delete`, headers: as(who), payload: { clientMutationId } });
      expect((await remove(manager)).statusCode).toBe(409);
      expect((await status(member, "COMPLETED")).statusCode).toBe(200);
      expect((await lifecycle("archive", manager)).statusCode).toBe(200);
      expect((await remove(member)).statusCode).toBe(403);
      const deleteMutation = mutation();
      const deleted = await remove(manager, deleteMutation);
      expect(deleted.statusCode).toBe(200);
      expect(deleted.json().result).toEqual({ action: "DELETE", sheetId, replayed: false });
      expect((await remove(manager, deleteMutation)).json().result).toEqual({ action: "DELETE", sheetId, replayed: true });
      expect((await remove(manager)).statusCode).toBe(404);
      expect(await connection.db.select({ id: productionSheets.id }).from(productionSheets).where(eq(productionSheets.id, sheetId))).toEqual([]);
      const [deleteAudit] = await connection.db.select().from(auditEvents).where(and(eq(auditEvents.targetId, sheetId), eq(auditEvents.action, "SHEET_DELETED")));
      expect(deleteAudit).toMatchObject({ actorUserId: manager.id, targetType: "PRODUCTION_SHEET" });
      // Recorded without the sheet's values.
      expect(Object.keys(deleteAudit!.metadata ?? {}).sort()).toEqual(
        ["archivedAt", "attachmentFiles", "clientMutationId", "departmentId", "sheetNumber", "subpageId", "template"],
      );

      // A form its department may not create, received by 送交, is not governed
      // by ticks either; release-routing.integration.test.ts covers it. A
      // finished sheet is no longer handed on (the user, 2026-10-04).
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
