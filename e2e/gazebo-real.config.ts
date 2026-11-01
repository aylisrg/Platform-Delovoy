import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
import base from "../playwright.config";

/** Real Next server and real local PostgreSQL/Redis; no fixture adapters. */
export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: "gazebo-gallery.spec.ts",
  retries: 0,
  timeout: 90_000,
  webServer: {
    ...base.webServer,
    command: "node .next/standalone/server.js",
    cwd: resolve(__dirname, ".."),
  },
  projects: [{
    name: "chromium",
    use: {
      browserName: "chromium",
      launchOptions: process.env.GAZEBO_TEST_CHROMIUM
        ? { executablePath: process.env.GAZEBO_TEST_CHROMIUM }
        : undefined,
    },
  }],
});
