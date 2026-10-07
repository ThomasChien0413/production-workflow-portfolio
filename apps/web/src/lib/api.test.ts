import { afterEach, describe, expect, it, vi } from "vitest";

const cookieHeader = vi.fn(() => "workflow_session=abc");
const redirect = vi.fn((path: string) => {
  // Next's redirect throws to unwind the render; mimic that so a test can tell
  // a redirect apart from a return.
  throw new Error(`REDIRECT:${path}`);
});

vi.mock("next/headers", () => ({
  cookies: async () => ({ toString: cookieHeader }),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirect(path),
}));

const { ApiRequestError, apiOptional, apiRequire } = await import("./api.js");

function respond(status: number, body: unknown = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  redirect.mockClear();
  cookieHeader.mockReturnValue("workflow_session=abc");
});

describe("apiRequire", () => {
  it("returns the body on success", async () => {
    respond(200, { sheets: [{ id: "one" }] });
    await expect(apiRequire("/api/sheets")).resolves.toEqual({
      sheets: [{ id: "one" }],
    });
  });

  it("returns null for 404 so the caller can render not-found", async () => {
    respond(404);
    await expect(apiRequire("/api/sheets/missing")).resolves.toBeNull();
  });

  it("throws on a server error rather than answering with emptiness", async () => {
    // The whole point of the helper: an outage must not render as "no sheets".
    respond(500);
    await expect(apiRequire("/api/sheets")).rejects.toBeInstanceOf(ApiRequestError);
  });

  it("throws when the server cannot be reached at all", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(apiRequire("/api/sheets")).rejects.toBeInstanceOf(ApiRequestError);
  });

  it("sends an expired session to sign in instead of to an error screen", async () => {
    respond(401);
    await expect(apiRequire("/api/sheets")).rejects.toThrow("REDIRECT:/login");
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("sends a revoked permission home", async () => {
    respond(403);
    await expect(apiRequire("/api/audit")).rejects.toThrow("REDIRECT:/");
  });

  it("redirects to sign in when there is no session cookie at all", async () => {
    cookieHeader.mockReturnValue("");
    respond(200);
    await expect(apiRequire("/api/sheets")).rejects.toThrow("REDIRECT:/login");
  });
});

describe("apiOptional", () => {
  it("returns the fallback on any failure, including a forbidden roster", async () => {
    respond(403);
    await expect(apiOptional("/api/departments/x/staff", { staff: [] })).resolves.toEqual(
      { staff: [] },
    );
  });

  it("never throws when the server is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(apiOptional("/api/notifications", { unread: 0 })).resolves.toEqual({
      unread: 0,
    });
  });
});
