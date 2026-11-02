// Only launched by the guarded CI spec. No application server or provider calls.
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import type { Prisma } from "@prisma/client";
import { paidE2EEnvironment } from "./ps-park-test-server";

const RELEASE_ID = "ps-park-online-booking-v2-2026-11";
const AUDIT_ID = `release:${RELEASE_ID}`;
const EXPECTED_SHA = "a".repeat(40);

async function main() {
  const connection = paidE2EEnvironment(process.env);
  if (process.env.PS_PARK_RELEASE_E2E_ONLY !== "synthetic-ci-activation" ||
      process.env.YOOKASSA_SHOP_ID !== "e2e-release-synthetic-shop" ||
      process.env.YOOKASSA_SECRET_KEY !== "e2e-release-synthetic-key") {
    throw new Error("SYNTHETIC_RELEASE_ENV_REQUIRED");
  }
  // Prisma must not discover ambient .env credentials in a developer checkout.
  if (readdirSync(process.cwd()).some(name => name.startsWith(".env") && name !== ".env.example")) {
    throw new Error("AMBIENT_ENV_FILES_FORBIDDEN");
  }
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls++; throw new Error("RELEASE_E2E_NETWORK_FORBIDDEN"); };
  // Dynamic imports occur after the environment/network boundary is installed.
  const { PrismaClient } = await import("@prisma/client");
  const { activatePSParkRelease } = await import("../../scripts/lib/ps-park-release");
  const db = new PrismaClient({ datasourceUrl: connection.databaseURL, log: [] });
  const context = {
    expectedSha: EXPECTED_SHA, nodeEnv: process.env.NODE_ENV,
    appUrl: process.env.NEXT_PUBLIC_APP_URL, buildSha: process.env.BUILD_GIT_SHA,
  };
  async function park() {
    return db.module.findUniqueOrThrow({ where: { slug: "ps-park" } });
  }
  async function config() {
    return (await park()).config as Prisma.JsonObject;
  }
  async function assertApplied() {
    const current = await config();
    assert.equal(current.onlineBookingEnabled, true);
    assert.equal(current.onlineBookingActivationRelease, RELEASE_ID);
    const markers = await db.auditLog.findMany({ where: { id: AUDIT_ID } });
    assert.equal(markers.length, 1);
    assert.equal(markers[0].userId, "system");
    assert.equal(markers[0].action, "ps-park.online-booking.release");
    assert.equal(markers[0].entity, "Module");
    assert.equal(markers[0].entityId, (await park()).id);
    assert.equal((markers[0].metadata as Record<string, unknown>).deploymentSha, EXPECTED_SHA);
  }
  try {
    switch (process.argv[2]) {
      case "concurrent": {
        const results = await Promise.all([
          activatePSParkRelease(db, context), activatePSParkRelease(db, context), activatePSParkRelease(db, context),
        ]);
        assert.equal(results.filter(result => result.changed).length, 1);
        assert.equal(results.filter(result => result.alreadyApplied).length, 2);
        assert.ok(results.every(result => result.onlineBookingEnabled));
        await assertApplied();
        break;
      }
      case "manual-off":
      case "missing-config-marker": {
        assert.equal((await activatePSParkRelease(db, context)).changed, true);
        const disabled: Prisma.JsonObject = { ...await config(), onlineBookingEnabled: false };
        if (process.argv[2] === "missing-config-marker") delete disabled.onlineBookingActivationRelease;
        await db.module.update({ where: { slug: "ps-park" }, data: { config: disabled } });
        const markerBefore = await db.auditLog.findUniqueOrThrow({ where: { id: AUDIT_ID } });
        const result = await activatePSParkRelease(db, context);
        assert.deepEqual(result, { onlineBookingEnabled: false, changed: false, alreadyApplied: true });
        assert.equal((await config()).onlineBookingEnabled, false);
        assert.equal(await db.auditLog.count({ where: { id: AUDIT_ID } }), 1);
        assert.deepEqual(await db.auditLog.findUniqueOrThrow({ where: { id: AUDIT_ID } }), markerBefore);
        break;
      }
      case "audit-rollback": {
        const name = process.env.PS_PARK_RELEASE_E2E_TRIGGER ?? "";
        if (!/^e2e_ps_release_[a-f0-9]{16}$/.test(name)) throw new Error("SYNTHETIC_TRIGGER_REQUIRED");
        const before = (await park()).config;
        // Owned, uniquely named trigger fails only the single release audit insert.
        // This tests a genuine PostgreSQL error and transaction rollback, not a mock.
        try {
          await db.$executeRawUnsafe(`CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'E2E_RELEASE_AUDIT_FAILURE'; END; $$`);
          await db.$executeRawUnsafe(`CREATE TRIGGER "${name}" BEFORE INSERT ON "AuditLog" FOR EACH ROW WHEN (NEW.id = '${AUDIT_ID}') EXECUTE FUNCTION "${name}"()`);
          await assert.rejects(() => activatePSParkRelease(db, context), error =>
            error instanceof Error && error.message.includes("E2E_RELEASE_AUDIT_FAILURE"));
          assert.deepEqual((await park()).config, before);
          assert.equal(await db.auditLog.count({ where: { id: AUDIT_ID } }), 0);
        } finally {
          await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${name}" ON "AuditLog"`);
          await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${name}"()`);
        }
        assert.equal((await activatePSParkRelease(db, context)).changed, true);
        await assertApplied();
        break;
      }
      default: throw new Error("UNKNOWN_RELEASE_E2E_SCENARIO");
    }
    assert.equal(fetchCalls, 0, "Activation must only check provider configuration, never contact it");
    console.log(`RELEASE_E2E_OK ${process.argv[2]}`);
  } finally { await db.$disconnect(); }
}

void main().catch((error: unknown) => {
  const detail = error instanceof assert.AssertionError ? error.message :
    error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "RELEASE_E2E_FAILED";
  console.error(`RELEASE_E2E_ERROR ${detail}`);
  process.exitCode = 1;
});
