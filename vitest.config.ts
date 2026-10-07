import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // PostgreSQL integration files share the singleton business-role indexes.
    // Serial files prevent independent fixtures from racing for the same role.
    fileParallelism: false,
    coverage: {
      include: ["apps/**/*.ts", "packages/**/*.ts"],
      reporter: ["text", "html"],
    },
    environment: "node",
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
  },
});
