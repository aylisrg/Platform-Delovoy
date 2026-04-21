import { auth } from "@/lib/auth";
import {
  apiResponse,
  apiError,
  apiForbidden,
  apiUnauthorized,
  apiValidationError,
  apiServerError,
} from "@/lib/api-response";
import { deployStagingSchema } from "@/modules/backups/validation";
import { prisma } from "@/lib/db";

const DEFAULT_REPO_OWNER = "aylisrg";
const DEFAULT_REPO_NAME = "platform-delovoy";
const WORKFLOW_FILE = "deploy-staging.yml";

/**
 * POST /api/admin/deploy/staging
 * Thin proxy: triggers GitHub `workflow_dispatch` for deploy-staging.yml.
 * All SSH / docker work happens inside the Action, not inside the app —
 * this keeps secrets out of the Node process.
 *
 * SUPERADMIN only.
 * Requires env:
 *   GITHUB_DISPATCH_TOKEN     — fine-grained PAT с actions:write
 *   GITHUB_REPO_OWNER         — optional (default aylisrg)
 *   GITHUB_REPO_NAME          — optional (default platform-delovoy)
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  if (session.user.role !== "SUPERADMIN") return apiForbidden();

  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) {
    return apiError(
      "GITHUB_TOKEN_MISSING",
      "GITHUB_DISPATCH_TOKEN не задан на сервере — добавьте PAT с scope actions:write",
      500
    );
  }

  let body: unknown;
  try {
    body = await request.json().catch(() => ({}));
  } catch {
    return apiValidationError("Некорректный JSON");
  }
  const parsed = deployStagingSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return apiValidationError(
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")
    );
  }

  const owner = process.env.GITHUB_REPO_OWNER || DEFAULT_REPO_OWNER;
  const repo = process.env.GITHUB_REPO_NAME || DEFAULT_REPO_NAME;
  const ref = parsed.data.ref || "main";

  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`;

  try {
    const ghRes = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "platform-delovoy-admin-deploy",
      },
      body: JSON.stringify({
        ref,
        inputs: {
          sha: parsed.data.sha ?? "",
          wipe_database: parsed.data.wipeDatabase ? "true" : "false",
        },
      }),
    });

    if (!ghRes.ok) {
      const errText = await ghRes.text().catch(() => "");
      return apiError(
        "GITHUB_API_ERROR",
        `GitHub API вернул ${ghRes.status}: ${errText.slice(0, 500)}`,
        502
      );
    }

    // GitHub dispatches endpoint returns 204 No Content; actual run_id появляется
    // через list-runs API. Возвращаем URL на страницу Actions.
    const workflowUrl = `https://github.com/${owner}/${repo}/actions/workflows/${WORKFLOW_FILE}`;

    await prisma.auditLog.create({
      data: {
        userId: session.user.id,
        action: "deploy.staging.trigger",
        entity: "Deploy",
        entityId: parsed.data.sha ?? ref,
        metadata: {
          sha: parsed.data.sha ?? null,
          ref,
          wipeDatabase: parsed.data.wipeDatabase,
        },
      },
    });

    return apiResponse(
      {
        status: "triggered",
        workflowUrl,
        sha: parsed.data.sha ?? null,
        ref,
      },
      undefined,
      202
    );
  } catch (err) {
    console.error("[admin/deploy/staging] dispatch failed:", err);
    return apiServerError("Не удалось вызвать GitHub dispatch");
  }
}
