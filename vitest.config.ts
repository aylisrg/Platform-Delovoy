import { defineConfig, defaultExclude } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    globals: true,
    // e2e/*.spec.ts use @playwright/test's own test runner (playwright.config.ts,
    // `npm run e2e`) — Vitest's default include pattern would otherwise also
    // pick them up and fail (no `page`/`request` fixtures under Vitest).
    exclude: [...defaultExclude, "e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: [
        "src/modules/**/*.ts",
        "src/lib/**/*.ts",
        "src/app/api/**/*.ts",
      ],
      exclude: [
        "src/modules/**/types.ts",
        "src/app/api/**/route.ts.d.ts",
        "**/__tests__/**",
      ],
    },
  },
});
