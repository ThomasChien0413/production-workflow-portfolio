import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)("authentication routes with PostgreSQL", () => {
  it("logs in the bootstrap admin and resolves the server-side session", async () => {
    const app = await buildApp(
      loadConfig({
        DATABASE_URL: testDatabaseUrl,
        NODE_ENV: "test",
        APP_ORIGIN: "http://localhost:3000",
      }),
    );

    try {
      const login = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { origin: "http://localhost:3000" },
        payload: { username: "admin", password: "DemoOnly2026!" },
      });

      expect(login.statusCode).toBe(200);
      expect(login.json().user).toMatchObject({
        username: "admin",
        passwordWarning: true,
        roles: ["ADMIN"],
      });

      const setCookie = login.headers["set-cookie"];
      const cookieLines = Array.isArray(setCookie) ? setCookie : [setCookie ?? ""];
      const cookieHeader = cookieLines
        .map((line) => line.split(";", 1)[0])
        .filter(Boolean)
        .join("; ");

      const session = await app.inject({
        method: "GET",
        url: "/api/auth/session",
        headers: { cookie: cookieHeader },
      });

      expect(session.statusCode).toBe(200);
      expect(session.json().user.username).toBe("admin");
    } finally {
      await app.close();
    }
  });
});
