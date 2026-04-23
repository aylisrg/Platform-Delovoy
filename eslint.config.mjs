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
  // ADR 2026-04-23: unified date/time formatting.
  // Disallow Date.prototype.toLocaleDateString / toLocaleTimeString and Intl.DateTimeFormat
  // in UI code (components + app). Use src/lib/format.ts instead.
  // NB: Number.prototype.toLocaleString("ru-RU") for money is NOT blocked —
  // only Date-specific methods are flagged.
  {
    files: ["src/components/**/*.{ts,tsx}", "src/app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name='toLocaleDateString']",
          message:
            "Use formatDate/formatDateTime from '@/lib/format' instead of Date.toLocaleDateString. See ADR 2026-04-23.",
        },
        {
          selector:
            "CallExpression[callee.property.name='toLocaleTimeString']",
          message:
            "Use formatTime/formatDateTime from '@/lib/format' instead of Date.toLocaleTimeString. See ADR 2026-04-23.",
        },
        {
          selector:
            "NewExpression[callee.object.name='Intl'][callee.property.name='DateTimeFormat']",
          message:
            "Use formatDate/formatTime/formatDateTime from '@/lib/format' instead of new Intl.DateTimeFormat. See ADR 2026-04-23.",
        },
      ],
    },
  },
  // Format module itself is allowed to use these APIs (it's the single source of truth).
  {
    files: ["src/lib/format.ts", "src/lib/__tests__/format.test.ts"],
    rules: {
      "no-restricted-syntax": "off",
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
    // Claude Code worktrees (parallel branch checkouts)
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;
