import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    settings: {
      // Pin React version explicitly so eslint-plugin-react skips auto-detection
      // (auto-detection calls context.getFilename() which was removed in ESLint 10).
      react: { version: "19" },
    },
    rules: {
      // Downgrade to warning — existing code uses setState in effects for data loading
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Separate landing project — has its own config
    "landing-delovoy-park.ru/**",
    // Bot — separate process
    "bot/**",
  ]),
]);

export default eslintConfig;
