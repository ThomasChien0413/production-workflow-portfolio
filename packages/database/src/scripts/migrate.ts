import "./load-env.js";
import { assertLocalDemoDatabase } from "./demo-target.js";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "../client.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
assertLocalDemoDatabase(databaseUrl);

const connection = createDatabase(databaseUrl, 1);

try {
  await migrate(connection.db, {
    migrationsFolder: fileURLToPath(new URL("../../migrations", import.meta.url)),
  });
  process.stdout.write("Database migrations completed.\n");
} finally {
  await connection.close();
}
