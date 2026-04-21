import bcrypt from "bcryptjs";
import { DeletionType, Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { prisma } from "./db";
import {
  apiError,
  apiForbidden,
  apiUnauthorized,
  apiValidationError,
} from "./api-response";
import { logAudit, logEvent } from "./logger";

/**
 * Minimal session shape required by guard helpers.
 * Matches the NextAuth session we already use across the app.
 */
export type SessionLike = {
  user?: {
    id?: string | null;
    role?: string | null;
    email?: string | null;
    name?: string | null;
  } | null;
} | null;

export type DeletionContext = {
  entity: string;          // "Booking", "Order", "MenuItem", ...
  entityId: string;
  entityLabel?: string;    // Human-readable hint for the log UI
  moduleSlug?: string;     // "gazebos" | "ps-park" | "cafe" | "inventory" | ...
  deletionType?: DeletionType;
  snapshot: unknown;       // Full row as it existed before deletion
  reason?: string | null;
};

/**
 * Outcome of verifying a SUPERADMIN password-confirmed deletion request.
 * If `response` is set, the caller should return it directly.
 * Otherwise `actor`, `password`, `reason`, `ipAddress`, `userAgent` are filled
 * and the caller should proceed with the actual deletion, then call `logDeletion`.
 */
export type DeletionAuthorization =
  | {
      ok: false;
      response: Response;
    }
  | {
      ok: true;
      actor: {
        id: string;
        role: string;
        email: string | null;
        name: string | null;
      };
      reason: string | null;
      ipAddress: string | null;
      userAgent: string | null;
    };

/** Verify a plain-text password against a user's stored bcrypt hash. */
export async function verifyUserPassword(
  userId: string,
  password: string
): Promise<{ ok: boolean; reason?: "NO_PASSWORD" | "INVALID" | "USER_NOT_FOUND" }> {
  if (!password) return { ok: false, reason: "INVALID" };
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (!user) return { ok: false, reason: "USER_NOT_FOUND" };
  if (!user.passwordHash) return { ok: false, reason: "NO_PASSWORD" };
  const matches = await bcrypt.compare(password, user.passwordHash);
  return matches ? { ok: true } : { ok: false, reason: "INVALID" };
}

function pickIp(request: NextRequest): string | null {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || null;
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return null;
}

/**
 * Parse the JSON body of a DELETE request, tolerating empty bodies.
 * Returns `{ password, reason }` or `null` if the body cannot be parsed.
 */
export async function parseDeletionBody(
  request: NextRequest
): Promise<{ password?: string; reason?: string } | null> {
  try {
    const text = await request.text();
    if (!text) return {};
    const json = JSON.parse(text) as Record<string, unknown>;
    return {
      password: typeof json.password === "string" ? json.password : undefined,
      reason: typeof json.reason === "string" ? json.reason : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Gate a destructive action behind: login + SUPERADMIN role + password re-auth.
 *
 * Usage in a Route Handler:
 *
 *   const auth = await authorizeSuperadminDeletion(request, session);
 *   if (!auth.ok) return auth.response;
 *   // ...perform deletion...
 *   await logDeletion(auth, { entity, entityId, snapshot, ... });
 */
export async function authorizeSuperadminDeletion(
  request: NextRequest,
  session: SessionLike
): Promise<DeletionAuthorization> {
  if (!session?.user?.id) {
    return { ok: false, response: apiUnauthorized() };
  }
  if (session.user.role !== "SUPERADMIN") {
    return {
      ok: false,
      response: apiForbidden("Удаление доступно только суперадмину"),
    };
  }

  const body = await parseDeletionBody(request);
  if (body === null) {
    return {
      ok: false,
      response: apiValidationError("Некорректное тело запроса"),
    };
  }
  const password = body.password;
  if (!password) {
    return {
      ok: false,
      response: apiError(
        "PASSWORD_REQUIRED",
        "Для удаления требуется подтверждение паролем",
        422
      ),
    };
  }

  const check = await verifyUserPassword(session.user.id, password);
  if (!check.ok) {
    if (check.reason === "NO_PASSWORD") {
      return {
        ok: false,
        response: apiError(
          "PASSWORD_NOT_SET",
          "У вашего аккаунта не задан пароль — установите пароль в профиле, чтобы подтверждать удаление",
          409
        ),
      };
    }
    // Record the failed attempt — this is a security-relevant signal.
    await logEvent(
      "WARNING",
      "deletion.guard",
      "Неверный пароль при попытке удаления",
      {
        userId: session.user.id,
        userEmail: session.user.email ?? null,
        ip: pickIp(request),
      }
    );
    return {
      ok: false,
      response: apiError("INVALID_PASSWORD", "Неверный пароль", 403),
    };
  }

  return {
    ok: true,
    actor: {
      id: session.user.id,
      role: session.user.role ?? "SUPERADMIN",
      email: session.user.email ?? null,
      name: session.user.name ?? null,
    },
    reason: body.reason?.trim() ? body.reason.trim() : null,
    ipAddress: pickIp(request),
    userAgent: request.headers.get("user-agent"),
  };
}

/**
 * Write a DeletionLog row (and a mirror AuditLog entry for backwards-compat
 * with the existing architect/audit viewer). Fails soft — logging errors
 * must never surface to the caller and abort the user-visible action, but
 * they are surfaced through SystemEvent so ops sees them.
 */
export async function logDeletion(
  auth: Extract<DeletionAuthorization, { ok: true }>,
  ctx: DeletionContext
): Promise<void> {
  const deletionType = ctx.deletionType ?? DeletionType.SOFT;

  // Prisma's `Json` input type rejects arbitrary `unknown`. Round-trip through
  // JSON.stringify so Decimal, Date, etc. become safe primitives for storage.
  let snapshotJson: Prisma.InputJsonValue;
  try {
    snapshotJson = JSON.parse(JSON.stringify(ctx.snapshot)) as Prisma.InputJsonValue;
  } catch {
    snapshotJson = { _unserializable: true } as Prisma.InputJsonValue;
  }

  try {
    await prisma.deletionLog.create({
      data: {
        userId: auth.actor.id,
        userEmail: auth.actor.email,
        userName: auth.actor.name,
        userRole: auth.actor.role,
        entity: ctx.entity,
        entityId: ctx.entityId,
        entityLabel: ctx.entityLabel ?? null,
        moduleSlug: ctx.moduleSlug ?? null,
        deletionType,
        snapshot: snapshotJson,
        reason: ctx.reason ?? auth.reason,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      },
    });
  } catch (err) {
    await logEvent("ERROR", "deletion.log", "Не удалось записать DeletionLog", {
      entity: ctx.entity,
      entityId: ctx.entityId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Mirror into AuditLog so the existing /admin/architect/logs viewer keeps
  // showing deletions in the unified action history.
  await logAudit(
    auth.actor.id,
    `${ctx.entity.toLowerCase()}.delete`,
    ctx.entity,
    ctx.entityId,
    {
      moduleSlug: ctx.moduleSlug,
      deletionType,
      reason: ctx.reason ?? auth.reason,
      entityLabel: ctx.entityLabel,
    }
  );
}
