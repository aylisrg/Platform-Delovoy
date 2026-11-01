import { z } from "zod";
import { apiResponse, apiError } from "@/lib/api-response";
import { announceRelease, manualReleaseId, normalizeManualReleaseNotes } from "@/modules/notifications/release-notify";

/**
 * POST /api/admin/release-notify
 *
 * Called by GitHub Actions after a successful production deploy.
 * Default identity: package version. Explicit curated updates: normalized
 * manual-note hash, unchanged across technical redeploys and version bumps.
 * The result describes queue acceptance/skips/errors, never Telegram delivery.
 *
 * Authentication: RELEASE_NOTIFY_SECRET env var (bearer token in body).
 */

const schema = z.object({
  secret: z.string().min(1),
  version: z.string().max(80).regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/),
  releaseNotes: z.string().max(12000).default(""),
  commitSha: z.string().regex(/^[a-fA-F0-9]{7,64}$/),
  deployedAt: z.string().datetime().default(() => new Date().toISOString()),
  updateId: z.string().regex(/^manual:[a-f0-9]{64}$/).optional(),
}).superRefine((value, ctx) => {
  if (value.updateId && (!normalizeManualReleaseNotes(value.releaseNotes) || value.updateId !== manualReleaseId(value.releaseNotes))) {
    ctx.addIssue({ code: "custom", path: ["updateId"], message: "Curated update identity must match nonempty manual notes" });
  }
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => i.message).join(", ");
      return apiError("VALIDATION_ERROR", msg, 400);
    }

    const expected = process.env.RELEASE_NOTIFY_SECRET;
    if (!expected) {
      return apiError(
        "NOT_CONFIGURED",
        "RELEASE_NOTIFY_SECRET is not set on this server",
        503
      );
    }

    if (parsed.data.secret !== expected) {
      return apiError("UNAUTHORIZED", "Invalid release notify secret", 401);
    }

    const { version, releaseNotes, commitSha, deployedAt, updateId } = parsed.data;
    const result = await announceRelease({
      version,
      releaseNotes,
      commitSha,
      deployedAt,
      ...(updateId ? { updateId } : {}),
    });

    return apiResponse({
      ...result,
      // Compatibility field: means newly queued, not personally delivered.
      announced: result.queued > 0,
      ...(result.status === "skipped" ? { skippedReason: result.reason } : {}),
    });
  } catch {
    return apiError("INTERNAL_ERROR", "Failed to send release notification", 500);
  }
}
