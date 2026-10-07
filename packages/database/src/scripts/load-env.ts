import { fileURLToPath } from "node:url";
import { config } from "dotenv";

// These scripts are invoked through `pnpm --filter @workflow/database`, so the
// working directory is packages/database rather than the workspace root.
// `dotenv/config` resolves .env against the working directory, which means the
// setup documented in README.md — copy .env.example to the repo root, then run
// pnpm db:migrate — could never find it. Resolve the workspace root explicitly.
//
// Real environment variables still win: dotenv does not overwrite anything that
// is already set, so CI, which exports DATABASE_URL directly, is unaffected.
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)) });
