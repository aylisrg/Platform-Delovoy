import { NextRequest } from 'next/server';
import { apiError, apiForbidden, apiResponse, apiUnauthorized } from '@/lib/api-response';
import { verifyBotRequest } from '@/lib/bot-auth';
import { botDecisionSchema } from '@/modules/owner-decisions/validation';
import {
  attachNote,
  createOwnerIdea,
  listDecisions,
  ownerDecide,
} from '@/modules/owner-decisions/service';

/**
 * /api/bot/owner-decisions — грань контура решений для Telegram-бота
 * (паттерн cancel-booking: verifyBotRequest + доменный сервис + AuditLog).
 *
 * Двойная проверка владельца намеренно: бот сверяет ctx.from.id сам, но и
 * сервер не доверяет боту на слово — telegramUserId обязан совпадать с
 * TELEGRAM_OWNER_CHAT_ID. Кнопки мержа в прод — не место для «кто угодно
 * с токеном бота».
 *
 * Файл — в HOLD_PATTERNS гейта (ADR 2026-08-20-owner-out-of-github).
 */

export async function POST(request: NextRequest) {
  if (!verifyBotRequest(request)) return apiUnauthorized('Invalid bot token');
  try {
    const parsed = botDecisionSchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError('VALIDATION_ERROR', parsed.error.issues.map((i) => i.message).join(', '), 400);
    }
    const body = parsed.data;

    const ownerId = process.env.TELEGRAM_OWNER_CHAT_ID;
    if (!ownerId) return apiError('NOT_CONFIGURED', 'TELEGRAM_OWNER_CHAT_ID is not set', 503);
    if (body.telegramUserId !== ownerId) {
      return apiForbidden('Решения принимает только владелец');
    }

    switch (body.op) {
      case 'decide': {
        const result = await ownerDecide({
          decisionId: body.decisionId,
          action: body.action,
          note: body.note,
          telegramUserId: body.telegramUserId,
        });
        if (!result.ok) return apiError('DECISION_STATE', result.error ?? 'invalid state', 409);
        return apiResponse({ ack: result.ack, view: result.view });
      }
      case 'idea': {
        const result = await createOwnerIdea({ text: body.text, telegramUserId: body.telegramUserId });
        return apiResponse(result);
      }
      case 'note': {
        const result = await attachNote({
          telegramMessageId: body.telegramMessageId,
          text: body.text,
          telegramUserId: body.telegramUserId,
        });
        if (!result.ok) return apiError('DECISION_STATE', result.error ?? 'not a decision message', 409);
        return apiResponse({ ok: true });
      }
      case 'list': {
        return apiResponse(await listDecisions('pending'));
      }
    }
  } catch {
    return apiError('INTERNAL_ERROR', 'Failed to process owner decision', 500);
  }
}
