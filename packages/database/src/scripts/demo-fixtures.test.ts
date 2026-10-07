import { describe, expect, it } from "vitest";
import { assertPristineDemoWorkspace, DEMO_ACCOUNTS, initializeDemoFixtures } from "./demo-fixtures.js";

describe("optional synthetic demo fixtures", () => {
  it("accepts only an untouched bootstrap workspace", () => {
    expect(() => assertPristineDemoWorkspace(["admin"], 0, 0)).not.toThrow();
    for (const [names, sheets, pages] of [[[], 0, 0], [["admin", "someone"], 0, 0], [["admin"], 1, 0], [["admin"], 0, 1]] as const) {
      expect(() => assertPristineDemoWorkspace([...names], sheets, pages)).toThrow(/never overwritten/u);
    }
  });
  it("refuses remote, unrelated and production targets before opening a connection", async () => {
    await expect(initializeDemoFixtures("postgres://demo:test@remote.invalid/workflow_demo", "test")).rejects.toThrow(/loopback/u);
    await expect(initializeDemoFixtures("postgres://demo:test@localhost/company_data", "test")).rejects.toThrow(/database name/u);
    await expect(initializeDemoFixtures("postgres://demo:test@localhost/workflow_demo", "production")).rejects.toThrow(/production mode/u);
  });
  it("labels all sample accounts synthetic and uses unique explicit aliases", () => {
    expect(new Set(DEMO_ACCOUNTS.map(account => account.username)).size).toBe(5);
    expect(DEMO_ACCOUNTS.every(account => account.username.startsWith("demo.") && account.displayName.startsWith("範例"))).toBe(true);
  });
});
