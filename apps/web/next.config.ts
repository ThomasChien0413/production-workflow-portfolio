import type { NextConfig } from "next";
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";

// Next resolves .env from apps/web, while the repository intentionally keeps
// one ignored environment file at the workspace root. Load that file for local
// development; real container/CI variables continue to win.
loadEnv({
  path: fileURLToPath(new URL("../../.env", import.meta.url)),
  quiet: true,
});

const apiOrigin = process.env.API_ORIGIN ?? "http://127.0.0.1:3001";

const nextConfig: NextConfig = {
  // The UI package ships TypeScript source rather than a compiled bundle so
  // that "use client" directives and CSS imports survive intact.
  // The domain package is imported so screens ask the same functions the API
  // asks — which role a state is waiting on, who may act — instead of keeping a
  // second copy of the workflow that can silently drift out of step with it.
  transpilePackages: ["@workflow/ui", "@workflow/domain", "@workflow/sheet-document"],

  // Hostnames besides localhost that may load the dev server's scripts, so
  // a phone on the same network can try the app (comma-separated, from the
  // workspace .env). Empty by default; development only.
  allowedDevOrigins: (process.env.ALLOWED_DEV_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),

  // Proxy the API through this origin rather than letting the browser call
  // 127.0.0.1:3001 directly. Two reasons, both load-bearing:
  //
  // 1. The session cookie is SameSite=strict. localhost:3000 and 127.0.0.1:3001
  //    are different sites, so a direct cross-origin call would have the cookie
  //    silently dropped on every subsequent request.
  // 2. The API rejects unsafe methods whose Origin header does not match
  //    APP_ORIGIN. Proxying keeps the browser's Origin as this app's origin.
  //
  // Server components bypass this and call API_ORIGIN directly, forwarding the
  // cookie header themselves.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  },
};

export default nextConfig;
