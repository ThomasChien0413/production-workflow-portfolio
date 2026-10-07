import "./load-env.js";
import { initializeDemoFixtures } from "./demo-fixtures.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
console.log(JSON.stringify(await initializeDemoFixtures(databaseUrl)));
