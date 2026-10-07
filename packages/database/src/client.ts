import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export function createDatabase(databaseUrl: string, maxConnections = 10) {
  const client = postgres(databaseUrl, {
    max: maxConnections,
    prepare: false,
  });
  const db = drizzle(client, { schema });

  return {
    client,
    db,
    close: () => client.end(),
  };
}

export type Database = ReturnType<typeof createDatabase>["db"];
