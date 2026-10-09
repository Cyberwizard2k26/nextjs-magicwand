import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "lib/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: { PGLITE_MEMORY: "1", APP_SECRET: "test-secret-test-secret-test-secret-123456", NODE_ENV: "test", LOG_LEVEL: "error" },
    fileParallelism: false,
  },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
