import { describe, expect, it } from "vitest";
import { assertLocalDemoDatabase } from "./demo-target.js";

describe("portfolio database isolation", () => {
  it("allows dedicated local, test and Compose demo targets", () => {
    for (const host of ["127.0.0.1", "localhost", "[::1]", "postgres"]) {
      expect(() => assertLocalDemoDatabase(`postgres://demo:public-test@${host}:5432/workflow_demo_test`, "test")).not.toThrow();
    }
  });

  it("rejects production mode, remote hosts and unrelated databases without exposing credentials", () => {
    const urls = [
      "postgres://demo:must-not-appear@db.example.invalid:5432/workflow_demo",
      "postgres://demo:must-not-appear@127.0.0.1:5432/company_database",
      "invalid-url-must-not-appear",
    ];
    for (const url of urls) {
      try { assertLocalDemoDatabase(url, "test"); throw new Error("Guard did not reject"); }
      catch (error) {
        expect(String(error)).not.toContain("must-not-appear");
        expect(String(error)).not.toContain("Guard did not reject");
      }
    }
    expect(() => assertLocalDemoDatabase("postgres://demo:test@localhost/workflow_demo", "production")).toThrow(/production mode/u);
  });

  it("allows rehearsal names only for read-only verification", () => {
    const url = "postgres://demo:test@localhost/workflow_restore_rehearsal_ci";
    expect(() => assertLocalDemoDatabase(url, "test")).toThrow(/database name/u);
    expect(() => assertLocalDemoDatabase(url, "test", true)).not.toThrow();
  });
});
