import { timingSafeEqual } from 'node:crypto';
import { NextRequest } from 'next/server';
import { apiError, apiResponse } from '@/lib/api-response';
import {
  createDecisionSchema,
  executorPatchSchema,
  listDecisionsSchema,
} from '@/modules/owner-decisions/validation';
import {
  createDecisionRequest,
  listDecisions,
  markExecutor,
} from '@/modules/owner-decisions/service';

/**
 * /api/admin/owner-decisions — грань контура решений для GitHub Actions
 * (свипер issue-queue-merge.yml). Паттерн release-notify: аутентификация
 * общим секретом, никакой сессии. Секрет — в заголовке Authorization
 * (Bearer), а не в теле: тело логируется валидацией при ошибках.
 *
 *   POST  — запрос решения (идемпотентный upsert; сайт шлёт владельцу кнопки)
 *   GET   — список решений (?status=decided|pending|all)
 *   PATCH — отчёт исполнения от свипера (EXECUTED|EXPIRED)
 *
 * Файл — в HOLD_PATTERNS гейта: контур мержит hold-PR мимо гейта, менять его
 * автоматика сама не может (ADR 2026-08-20-owner-out-of-github).
 */

/** Constant-time сравнение (паттерн cron/webhook-роутов) — контур управляет мержем в прод. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function checkSecret(request: NextRequest): Response | null {
  const expected = process.env.OWNER_DECISIONS_SECRET;
  if (!expected) {
    return apiError('NOT_CONFIGURED', 'OWNER_DECISIONS_SECRET is not set on this server', 503);
  }
  const header = request.headers.get('authorization') ?? '';
  if (!safeEqual(header, `Bearer ${expected}`)) {
    return apiError('UNAUTHORIZED', 'Invalid owner-decisions secret', 401);
  }
  return null;
}

export async function POST(request: NextRequest) {
  const denied = checkSecret(request);
  if (denied) return denied;
  try {
    const parsed = createDecisionSchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError('VALIDATION_ERROR', parsed.error.issues.map((i) => i.message).join(', '), 400);
    }
    const result = await createDecisionRequest(parsed.data);
    return apiResponse(result);
  } catch {
    return apiError('INTERNAL_ERROR', 'Failed to create owner decision', 500);
  }
}

export async function GET(request: NextRequest) {
  const denied = checkSecret(request);
  if (denied) return denied;
  try {
    const parsed = listDecisionsSchema.safeParse({
      status: request.nextUrl.searchParams.get('status') ?? undefined,
    });
    if (!parsed.success) {
      return apiError('VALIDATION_ERROR', parsed.error.issues.map((i) => i.message).join(', '), 400);
    }
    return apiResponse(await listDecisions(parsed.data.status));
  } catch {
    return apiError('INTERNAL_ERROR', 'Failed to list owner decisions', 500);
  }
}

export async function PATCH(request: NextRequest) {
  const denied = checkSecret(request);
  if (denied) return denied;
  try {
    const parsed = executorPatchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError('VALIDATION_ERROR', parsed.error.issues.map((i) => i.message).join(', '), 400);
    }
    const result = await markExecutor(parsed.data);
    if (!result.ok) return apiError('NOT_FOUND', result.error ?? 'decision not found', 404);
    return apiResponse({ ok: true });
  } catch {
    return apiError('INTERNAL_ERROR', 'Failed to update owner decision', 500);
  }
}
