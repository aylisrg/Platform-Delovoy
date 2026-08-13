import { z } from "zod";
import { apiResponse, apiError } from "@/lib/api-response";
import { announceRelease } from "@/modules/notifications/release-notify";

/**
 * POST /api/admin/release-notify
 *
 * Called by GitHub Actions after a successful production deploy.
 * Анонсирует релиз подписчикам через dispatch() ровно один раз на версию
 * (серверная идемпотентность — таблица ReleaseAnnouncement, ADR §6).
 *
 * Ответ: { announced, queued, skippedReason? } — по `announced` пайплайн
 * решает, слать ли групповое fallback-сообщение «Deploy OK».
 *
 * Authentication: RELEASE_NOTIFY_SECRET env var (bearer token in body).
 */

const schema = z.object({
  secret: z.string().min(1),
  version: z.string().min(1),
  releaseNotes: z.string().default(""),
  commitSha: z.string().min(1),
  deployedAt: z.string().default(() => new Date().toISOString()),
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

    const { version, releaseNotes, commitSha, deployedAt } = parsed.data;
    const result = await announceRelease({
      version,
      releaseNotes,
      commitSha,
      deployedAt,
    });

    if (result.status === "skipped") {
      return apiResponse({
        announced: false,
        queued: 0,
        skippedReason: result.reason,
      });
    }

    return apiResponse({ announced: true, queued: result.queued });
  } catch {
    return apiError("INTERNAL_ERROR", "Failed to send release notification", 500);
  }
}
