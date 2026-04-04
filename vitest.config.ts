import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/modules/**/*.ts", "src/lib/**/*.ts"],
      exclude: ["src/modules/**/types.ts", "**/__tests__/**"],
    },
  },
});
