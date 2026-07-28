import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Integration tests share one PostgreSQL database and one Express app;
    // running files in parallel makes their counts race.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: "test",
      // The suite must never reach out to the GeM portal, so search is served
      // purely from PostgreSQL while testing.
      LIVE_SEARCH_ENABLED: "false",
    },
  },
});
