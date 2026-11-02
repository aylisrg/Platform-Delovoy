import type { AuditLog, Prisma, PrismaClient } from "@prisma/client";
import { getSeededSuperadminTelegramId } from "../../src/lib/seeded-superadmin";
import { assertOnlineBookingReady } from "../../src/modules/ps-park/online-readiness";

/** Fixed across subsequent builds so a later deploy cannot undo a manual OFF. */
export const PS_PARK_ACTIVATION_RELEASE_ID = "ps-park-online-booking-v2-2026-11";
export const PS_PARK_APPROVED_OFFER_HASH = "c9bd98373e0f5208dc358d7f6f631c641eddb9b6087f1291c10fecb25faacc9e";

const AUDIT_ID = `release:${PS_PARK_ACTIVATION_RELEASE_ID}`;
const AUDIT_ACTION = "ps-park.online-booking.release";
const SHA_PATTERN = /^[a-f0-9]{40}$/;

export type PSParkReleaseContext = {
  expectedSha: string;
  nodeEnv?: string;
  appUrl?: string;
  buildSha?: string;
};

function asObject(value: Prisma.JsonValue | null): Prisma.JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

export function assertPSParkReleaseContext(context: PSParkReleaseContext): void {
  if (context.nodeEnv !== "production" || !["https://delovoy-park.ru", "https://delovoy-park.ru/"].includes(context.appUrl ?? "")) {
    throw new Error("PRODUCTION_CONTEXT_REQUIRED");
  }
  if (!SHA_PATTERN.test(context.expectedSha) || context.buildSha !== context.expectedSha) {
    throw new Error("DEPLOYMENT_SHA_MISMATCH");
  }
}

function isReleaseAudit(audit: AuditLog | null, moduleId: string): boolean {
  const metadata = audit ? asObject(audit.metadata) : null;
  return audit?.userId === "system" && audit.action === AUDIT_ACTION &&
    audit.entity === "Module" && audit.entityId === moduleId &&
    metadata?.actorType === "system-deployment" && metadata.releaseId === PS_PARK_ACTIVATION_RELEASE_ID &&
    metadata.offerHash === PS_PARK_APPROVED_OFFER_HASH &&
    typeof metadata.deploymentSha === "string" && SHA_PATTERN.test(metadata.deploymentSha);
}

/** Called only by the deployment script, never exposed as an HTTP operation. */
export async function activatePSParkRelease(
  db: PrismaClient,
  context: PSParkReleaseContext,
): Promise<{ onlineBookingEnabled: boolean; changed: boolean; alreadyApplied: boolean }> {
  assertPSParkReleaseContext(context);

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Module" WHERE slug = 'ps-park' FOR UPDATE`;
    const park = await tx.module.findUnique({ where: { slug: "ps-park" } });
    if (!park) throw new Error("PS_PARK_NOT_FOUND");
    const config = park.config === null ? {} : asObject(park.config);
    if (!config) throw new Error("PS_PARK_CONFIG_INVALID");
    const onlineBookingEnabled = config.onlineBookingEnabled === true;
    const audit = await tx.auditLog.findUnique({ where: { id: AUDIT_ID } });
    const validAudit = isReleaseAudit(audit, park.id);
    if (audit && !validAudit) throw new Error("PS_PARK_RELEASE_MARKER_CONFLICT");
    const configMarker = config.onlineBookingActivationRelease;
    if (configMarker === PS_PARK_ACTIVATION_RELEASE_ID || validAudit) {
      return { onlineBookingEnabled, changed: false, alreadyApplied: true };
    }
    if (configMarker !== undefined || audit) throw new Error("PS_PARK_RELEASE_MARKER_CONFLICT");

    const system = await tx.user.findUnique({
      where: { id: "system" }, select: { role: true, mergedIntoUserId: true },
    });
    if (!system || system.role !== "USER" || system.mergedIntoUserId) throw new Error("SYSTEM_ACTOR_REQUIRED");
    const owner = await tx.user.findUnique({
      where: { telegramId: getSeededSuperadminTelegramId() },
      select: { id: true, role: true, mergedIntoUserId: true },
    });
    if (!owner || owner.id === "system" || owner.role !== "SUPERADMIN" || owner.mergedIntoUserId) {
      throw new Error("BOOTSTRAP_OWNER_REQUIRED");
    }
    await assertOnlineBookingReady(tx, park, PS_PARK_APPROVED_OFFER_HASH);

    const activated = await tx.module.update({ where: { slug: "ps-park" }, data: { config: {
      ...config, onlineBookingEnabled: true, onlineBookingActivationRelease: PS_PARK_ACTIVATION_RELEASE_ID,
    } } });
    await tx.auditLog.create({ data: {
      id: AUDIT_ID, userId: "system", action: AUDIT_ACTION, entity: "Module", entityId: park.id,
      metadata: {
        actorType: "system-deployment", releaseId: PS_PARK_ACTIVATION_RELEASE_ID,
        offerHash: PS_PARK_APPROVED_OFFER_HASH, deploymentSha: context.expectedSha,
        previousOnlineBookingEnabled: onlineBookingEnabled,
        activationUpdatedAt: activated.updatedAt.toISOString(),
      },
    } });
    return { onlineBookingEnabled: true, changed: true, alreadyApplied: false };
  });
}

/** Undo only this build's first enabling attempt after its live verification fails. */
export async function rollbackPSParkRelease(
  db: PrismaClient,
  context: PSParkReleaseContext,
): Promise<{ onlineBookingEnabled: boolean; changed: boolean }> {
  assertPSParkReleaseContext(context);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Module" WHERE slug = 'ps-park' FOR UPDATE`;
    const park = await tx.module.findUnique({ where: { slug: "ps-park" } });
    if (!park) throw new Error("PS_PARK_NOT_FOUND");
    const config = park.config === null ? {} : asObject(park.config);
    if (!config) throw new Error("PS_PARK_CONFIG_INVALID");
    const onlineBookingEnabled = config.onlineBookingEnabled === true;
    const unchanged = { onlineBookingEnabled, changed: false };
    if (!onlineBookingEnabled || config.onlineBookingActivationRelease !== PS_PARK_ACTIVATION_RELEASE_ID) return unchanged;
    const audit = await tx.auditLog.findUnique({ where: { id: AUDIT_ID } });
    const metadata = audit ? asObject(audit.metadata) : null;
    if (!audit || !isReleaseAudit(audit, park.id) || metadata?.deploymentSha !== context.expectedSha ||
      metadata.previousOnlineBookingEnabled !== false) return unchanged;
    // The architect editor audits after its separate update. Its row timestamp
    // must also veto rollback during the gap before that audit is written.
    if (metadata.activationUpdatedAt !== park.updatedAt.toISOString()) return unchanged;
    // Equality is intentional: an operator event in the same millisecond also wins.
    const manualChange = await tx.auditLog.findFirst({ where: {
      entity: "Module", entityId: park.id,
      action: { in: ["ps-park.online-booking", "module.config.update"] },
      createdAt: { gte: audit.createdAt },
    }, select: { id: true } });
    if (manualChange) return unchanged;
    await tx.module.update({ where: { slug: "ps-park" }, data: { config: { ...config, onlineBookingEnabled: false } } });
    await tx.auditLog.create({ data: {
      id: `${AUDIT_ID}:rollback:${context.expectedSha}`, userId: "system",
      action: "ps-park.online-booking.release.rollback", entity: "Module", entityId: park.id,
      metadata: {
        actorType: "system-deployment", releaseId: PS_PARK_ACTIVATION_RELEASE_ID,
        offerHash: PS_PARK_APPROVED_OFFER_HASH, deploymentSha: context.expectedSha,
      },
    } });
    return { onlineBookingEnabled: false, changed: true };
  });
}
