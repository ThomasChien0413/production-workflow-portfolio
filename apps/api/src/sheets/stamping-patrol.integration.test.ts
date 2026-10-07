import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { eq, inArray, like, or } from "drizzle-orm";
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
 * 沖壓 and 平板剪's 首件/巡迴檢驗單 (the user, 2026-09-30): written in either
 * department and kept there — a 平板剪 sheet is never sent to 沖壓, its owner
 * — with 公差 printed rather than written, and 外觀 ticked across the readings
 * while its 判定 is written.
 */
describe.skipIf(!testDatabaseUrl)("沖壓・平板剪 首件/巡迴檢驗單", () => {
  it("stays where it was written, prints 公差, and ticks 外觀 in one cell", async () => {
    const connection = createDatabase(testDatabaseUrl!, 1);
    const suffix = randomUUID().slice(0, 8);
    const password = `Patrol-${suffix}-Password!`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const userIds: string[] = [];
    const subpageIds: string[] = [];
    const mutationIds: string[] = [];
    const mutation = () => {
      const id = randomUUID();
      mutationIds.push(id);
      return id;
    };
    let sheetId: string | null = null;
    const app = await buildApp(loadConfig({ DATABASE_URL: testDatabaseUrl, NODE_ENV: "test", APP_ORIGIN: appOrigin }));

    try {
      const [flatShear] = await connection.db.select({ id: departments.id }).from(departments).where(eq(departments.code, "FLAT_SHEAR"));
      const flatShearId = flatShear!.id;
      const [template] = await connection.db.select({ id: sheetTemplates.id }).from(sheetTemplates)
        .where(eq(sheetTemplates.slug, "stamping-patrol-inspection"));
      const templateId = template!.id;

      const [user] = await connection.db.insert(users).values({
        username: `patrol-flat-shear-${suffix}`,
        displayName: "巡迴檢驗測試 平板剪主管",
        passwordHash,
      }).returning({ id: users.id, username: users.username });
      userIds.push(user!.id);
      await connection.db.insert(departmentMemberships).values({ userId: user!.id, departmentId: flatShearId, kind: "MANAGER" });
      const login = await app.inject({ method: "POST", url: "/api/auth/login", headers: { origin: appOrigin }, payload: { username: user!.username, password } });
      expect(login.statusCode).toBe(200);
      const manager = cookies(login);
      const as = { origin: appOrigin, cookie: manager.cookie, "x-csrf-token": manager.csrf };

      // A 平板剪 subpage that ticks the form, as its 主管 would.
      const created = await app.inject({ method: "POST", url: `/api/departments/${flatShearId}/subpages`, headers: as, payload: { clientMutationId: mutation(), name: `巡迴檢驗 ${suffix}` } });
      expect(created.statusCode).toBe(201);
      const subpageId = created.json().result.subpageId as string;
      subpageIds.push(subpageId);
      const ticked = await app.inject({ method: "PUT", url: `/api/departments/${flatShearId}/subpages/${subpageId}/templates`, headers: as, payload: { clientMutationId: mutation(), revision: 1, templateIds: [templateId] } });
      expect(ticked.statusCode).toBe(200);

      const sheet = await app.inject({ method: "POST", url: "/api/sheets", headers: as, payload: { clientMutationId: mutation(), templateId, originDepartmentId: flatShearId, subpageId } });
      expect(sheet.statusCode).toBe(201);
      sheetId = sheet.json().sheet.id as string;
      const detail = async () => (await app.inject({ method: "GET", url: `/api/sheets/${sheetId}`, headers: { cookie: manager.cookie } })).json().sheet;

      // Kept in 平板剪: nothing to send, its status set here.
      expect(await detail()).toMatchObject({ state: "READY", releaseDestination: null, currentDepartmentId: flatShearId });
      const send = await app.inject({ method: "POST", url: `/api/sheets/${sheetId}/submit`, headers: as, payload: { clientMutationId: mutation() } });
      expect(send.statusCode).toBe(409);

      const patch = async (fieldKey: string, value: string) =>
        app.inject({ method: "PATCH", url: `/api/sheets/${sheetId}/values`, headers: as, payload: { baseVersion: (await detail()).version, clientMutationId: mutation(), changes: [{ fieldKey, value }] } });
      // 公差 is printed: nothing may be written there.
      expect((await patch("firstPiece.a.tolerance", "±0.2")).statusCode).toBe(403);
      expect((await patch("firstPiece.a.standard", "30")).statusCode).toBe(200);
      // 外觀: 有 or 無 across the readings, and a written 判定.
      expect((await patch("firstPiece.scratch.standard", "無")).statusCode).toBe(200);
      // Only 有 or 無 may be ticked there; the validator refuses the rest (409).
      expect((await patch("firstPiece.scratch.standard", "也許")).statusCode).toBe(409);
      expect((await patch("firstPiece.scratch.verdict", "OK")).statusCode).toBe(200);
      // A round's 積厚, 有/無 and NG/OK.
      expect((await patch("rounds.stack.round1", "12")).statusCode).toBe(200);
      expect((await patch("rounds.rust.round2", "有")).statusCode).toBe(200);
      expect((await patch("rounds.orderNo.round1", "W-1")).statusCode).toBe(200);

      const status = await app.inject({ method: "POST", url: `/api/sheets/${sheetId}/status`, headers: as, payload: { clientMutationId: mutation(), baseVersion: (await detail()).version, state: "IN_PROGRESS" } });
      expect(status.statusCode).toBe(200);
      expect(await detail()).toMatchObject({ state: "IN_PROGRESS", currentDepartmentId: flatShearId });
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
