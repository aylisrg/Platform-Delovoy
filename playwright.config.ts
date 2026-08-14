import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.PORT ?? "3000";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

/**
 * E2E-флоу пишут в реальную БД CI-сервиса (issue #572) — параллельные
 * воркеры, бронирующие один и тот же затравочный ресурс/слот, дали бы
 * ложные конфликты бронирования. Пока набор маленький (5-7 флоу), серийный
 * прогон и так укладывается в бюджет ~8 мин из acceptance criteria.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 1,
  timeout: 30_000,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // `next start` warns and doesn't fully work with `output: "standalone"`
    // (next.config.ts) — run the same server.js prod actually runs
    // (docker-entrypoint.sh), built via `npm run build:e2e`.
    command: "node .next/standalone/server.js",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      PORT,
      // NextAuth v5 rejects requests whose Host header isn't pre-declared
      // trusted; localhost in CI/local E2E isn't, so auth callbacks 500
      // without this (surfaces as a generic "server configuration" error).
      AUTH_TRUST_HOST: "true",
    },
  },
});
