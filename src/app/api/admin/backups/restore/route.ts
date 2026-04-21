import { auth } from "@/lib/auth";
import {
  apiResponse,
  apiError,
  apiForbidden,
  apiUnauthorized,
  apiValidationError,
  apiServerError,
} from "@/lib/api-response";
import { restoreRequestSchema } from "@/modules/backups/validation";
import { planRestore, RestoreError } from "@/modules/backups/restore-service";
import { notifyRestore } from "@/modules/backups/notify";
import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";
import { randomBytes } from "crypto";

const CONFIRM_TOKEN_TTL_SECONDS = 60 * 5; // 5 minutes
const CONFIRM_TOKEN_PREFIX = "restore:confirm:";

function confirmKey(userId: string, token: string): string {
  return `${CONFIRM_TOKEN_PREFIX}${userId}:${token}`;
}

/**
 * Verify a confirm token issued to this user via GET /api/admin/backups/restore.
 * One-shot use: token is DEL'd on verification success.
 */
async function verifyConfirmToken(token: string, userId: string): Promise<boolean> {
  try {
    const key = confirmKey(userId, token);
    const val = await redis.get(key);
    if (!val) return false;
    // Burn the token so it can't be replayed
    await redis.del(key);
    return true;
  } catch {
    // Redis unavailable — fail closed for this destructive action
    return false;
  }
}

/**
 * GET /api/admin/backups/restore
 * Issue a short-lived confirm token that the client echoes back in POST body.
 * Prevents CSRF-like accidental triggering and adds explicit "yes, I mean it"
 * step beyond the session cookie.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  if (session.user.role !== "SUPERADMIN") return apiForbidden();

  const token = randomBytes(24).toString("hex");
  try {
    await redis.set(
      confirmKey(session.user.id, token),
      "1",
      "EX",
      CONFIRM_TOKEN_TTL_SECONDS
    );
  } catch (err) {
    console.error("[admin/backups/restore] Redis set failed:", err);
    return apiServerError("Не удалось подготовить токен — Redis недоступен");
  }

  return apiResponse({
    confirmToken: token,
    expiresInSeconds: CONFIRM_TOKEN_TTL_SECONDS,
  });
}

/**
 * POST /api/admin/backups/restore
 * Plan (and for dryRun=true — mark complete) a restore job. SUPERADMIN only.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  if (session.user.role !== "SUPERADMIN") return apiForbidden();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiValidationError("Некорректный JSON");
  }
  const parsed = restoreRequestSchema.safeParse(body);
  if (!parsed.success) {
    return apiValidationError(
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")
    );
  }

  try {
    const result = await planRestore(parsed.data, {
      performedById: session.user.id,
      verifyConfirmToken,
    });

    // Audit + telegram notify — always for destructive ops
    await prisma.auditLog.create({
      data: {
        userId: session.user.id,
        action: parsed.data.dryRun ? "backup.restore.dryrun" : "backup.restore.plan",
        entity: "BackupLog",
        entityId: result.backupLogId,
        metadata: {
          backupId: parsed.data.backupId,
          scope: parsed.data.scope,
          target: parsed.data.target ?? null,
          dryRun: parsed.data.dryRun,
        },
      },
    });

    await notifyRestore({
      scope: parsed.data.scope,
      table:
        parsed.data.target && parsed.data.target.scope !== "full"
          ? parsed.data.target.table
          : null,
      status: result.status,
      performedByName: session.user.name,
      dryRun: parsed.data.dryRun,
    });

    return apiResponse(result, undefined, result.dryRun ? 200 : 202);
  } catch (err) {
    if (err instanceof RestoreError) {
      switch (err.code) {
        case "BACKUP_NOT_FOUND":
          return apiError("BACKUP_NOT_FOUND", err.message, 404);
        case "RESTORE_IN_PROGRESS":
          return apiError("RESTORE_IN_PROGRESS", err.message, 409);
        case "CONFIRM_TOKEN_INVALID":
          return apiError("CONFIRM_TOKEN_INVALID", err.message, 422);
        default:
          return apiError("RESTORE_FAILED", err.message, 500);
      }
    }
    console.error("[admin/backups/restore] unexpected:", err);
    return apiServerError("Не удалось запустить restore");
  }
}
