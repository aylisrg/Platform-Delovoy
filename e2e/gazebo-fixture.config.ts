import { defineConfig } from "@playwright/test";

/** Local fixtures only; no Prisma, real assets, credentials or production traffic. */
export default defineConfig({
  testDir: ".", testMatch: "gazebo-interactions.fixture.ts", workers: 1, retries: 0,
  reporter: "list", outputDir: "../test-results/gazebo-fixture",
  use: {
    baseURL: "http://127.0.0.1:4179", headless: true,
    launchOptions: { executablePath: process.env.GAZEBO_TEST_CHROMIUM ?? "/usr/bin/chromium" },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npx --no-install vite --config e2e/fixtures/gazebos/vite.config.mts",
    url: "http://127.0.0.1:4179", reuseExistingServer: true, timeout: 30000,
  },
});
