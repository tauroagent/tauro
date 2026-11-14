import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    coverage: {
      include: ["packages/*/src/**/*.ts"],
      thresholds: { lines: 95, branches: 90 },
    },
  },
});
