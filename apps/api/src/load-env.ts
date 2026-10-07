import { fileURLToPath } from "node:url";
import { config } from "dotenv";

// `pnpm dev:api` runs with apps/api as the working directory, and
// `dotenv/config` resolves .env against the working directory — so the root
// .env described in README.md was never found. Resolve the workspace root
// explicitly instead.
//
// Real environment variables still win: dotenv does not overwrite anything that
// is already set, so containers and CI are unaffected.
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });
