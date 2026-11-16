import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    coverage: {
      include: ["packages/*/src/**/*.ts", "apps/worker/src/rounds.ts", "apps/worker/src/sealing.ts", "apps/worker/src/paper.ts"],
      thresholds: { lines: 95, branches: 90 },
    },
  },
});
