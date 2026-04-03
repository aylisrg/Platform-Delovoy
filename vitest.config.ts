import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
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
