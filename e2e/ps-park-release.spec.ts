import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { test, expect } from "@playwright/test";
import { paidE2EEnvironment } from "./helpers/ps-park-test-server";

const AUDIT_ID = "release:ps-park-online-booking-v2-2026-11";
const EXPECTED_SHA = "a".repeat(40);

test.describe("Play Park release activation against real PostgreSQL", () => {
  test.describe.configure({ mode: "serial", timeout: 60_000 });
  let db: PrismaClient;
  let savedConfig: Prisma.JsonValue;
  let ownsFixtures = false;
  const trigger = `e2e_ps_release_${randomBytes(8).toString("hex")}`;

  test.beforeAll(async () => {
    const connection = paidE2EEnvironment(process.env);
    db = new PrismaClient({ datasourceUrl: connection.databaseURL });
    const park = await db.module.findUniqueOrThrow({ where: { slug: "ps-park" } });
    savedConfig = park.config;
    const config = (park.config ?? {}) as Record<string, unknown>;
    // Never remove a marker or settings left by an existing release/operator.
    expect(await db.auditLog.count({ where: { id: AUDIT_ID } })).toBe(0);
    expect(config.onlineBookingActivationRelease).toBeUndefined();
    ownsFixtures = true;
  });

  test.beforeEach(async () => {
    const config = savedConfig && typeof savedConfig === "object" && !Array.isArray(savedConfig) ? savedConfig : {};
    await db.auditLog.deleteMany({ where: { id: AUDIT_ID } });
    await db.module.update({ where: { slug: "ps-park" }, data: { config: { ...config, onlineBookingEnabled: false } } });
  });

  test.afterAll(async () => {
    if (!db) return;
    try {
      if (ownsFixtures) {
        // Also clean up if the child was interrupted before its own finally ran.
        await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${trigger}" ON "AuditLog"`);
        await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${trigger}"()`);
        await db.auditLog.deleteMany({ where: { id: AUDIT_ID } });
        await db.module.update({ where: { slug: "ps-park" }, data: { config: savedConfig === null ? Prisma.DbNull : savedConfig } });
      }
    } finally { await db.$disconnect(); }
  });

  async function run(scenario: string) {
    const connection = paidE2EEnvironment(process.env);
    const child = spawn(process.execPath, ["--import", "tsx", resolve("e2e/helpers/ps-park-release-child.ts"), scenario], {
      cwd: process.cwd(),
      // No inherited provider/owner/production credentials and no NODE_OPTIONS.
      env: {
        PATH: process.env.PATH, LANG: "C.UTF-8", TZ: "UTC", NODE_ENV: "production",
        DATABASE_URL: connection.databaseURL, REDIS_URL: connection.redisURL,
        DEV_OVERLAY: "1", AUTH_SECRET: "e2e-ci-secret-not-for-prod-use",
        NEXT_PUBLIC_APP_URL: "https://delovoy-park.ru", BUILD_GIT_SHA: EXPECTED_SHA,
        YOOKASSA_SHOP_ID: "e2e-release-synthetic-shop", YOOKASSA_SECRET_KEY: "e2e-release-synthetic-key",
        YOOKASSA_WEBHOOK_SECRET: "e2e-release-synthetic-webhook", YOOKASSA_RECEIPTS_ENABLED: "true", YOOKASSA_VAT_CODE: "1",
        PS_PARK_RELEASE_E2E_ONLY: "synthetic-ci-activation", PS_PARK_RELEASE_E2E_TRIGGER: trigger,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const capture = (chunk: Buffer) => { output = (output + chunk.toString("utf8")).slice(-8_000); };
    child.stdout.on("data", capture); child.stderr.on("data", capture);
    const result = await new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
      const timeout = setTimeout(() => child.kill("SIGKILL"), 45_000);
      child.once("error", error => { clearTimeout(timeout); reject(error); });
      child.once("close", (code, signal) => { clearTimeout(timeout); resolve({ code, signal }); });
    });
    // Only test result markers are reported; raw Prisma diagnostics stay private.
    const diagnostics = output.split("\n").filter(line => line.startsWith("RELEASE_E2E_")).join("\n");
    expect(result, diagnostics || "Activation child failed before emitting a result").toEqual({ code: 0, signal: null });
    expect(diagnostics).toContain(`RELEASE_E2E_OK ${scenario}`);
  }

  test("AC-release-once: concurrent activation creates exactly one durable audit marker", () => run("concurrent"));
  test("AC-manual-off: subsequent deploy preserves an operator's OFF setting", () => run("manual-off"));
  test("AC-audit-marker: lost config marker never re-enables an already applied release", () => run("missing-config-marker"));
  test("AC-atomic: PostgreSQL audit insert failure rolls back config and allows safe retry", () => run("audit-rollback"));
});
