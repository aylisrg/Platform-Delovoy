/**
 * Owner-decisions — сервис решений владельца (infrastructure-only, без health).
 *
 * Хранит запросы решений автоочереди и ответы владельца. GitHub этот модуль
 * НЕ трогает: запросы создаёт и исполняет свипер (GitHub Actions, у него
 * AUTOMATION_TOKEN), бот только записывает нажатие кнопки. Схема защиты:
 * файлы контура — в HOLD_PATTERNS гейта, аппрув мержа пинится к head SHA,
 * исполнение — после grace-окна с кнопкой «Отменить», каждый шаг — в AuditLog.
 */
import { prisma } from '@/lib/db';
import { EVENT_SOURCES } from '@/lib/event-sources';
import { log, logAudit } from '@/lib/logger';
import { telegramApi } from '@/lib/telegram/client';
import { escapeHtml } from '@/lib/telegram/escape';
import {
  DECISION_CALLBACK_PREFIX,
  type CreateDecisionInput,
  type DecisionAction,
  type DecisionPayload,
  type DecisionView,
} from './types';

const GRACE_MINUTES = Number(process.env.OWNER_DECISIONS_GRACE_MINUTES ?? 15);

/**
 * Личный чат владельца — без fallback на админ-группу намеренно: кнопка
 * «Мержить в прод» в групповом чате — это чужие пальцы у рубильника.
 */
function ownerChatId(): string | undefined {
  return process.env.TELEGRAM_OWNER_CHAT_ID || undefined;
}

type DecisionRow = {
  id: string;
  kind: string;
  subjectType: string;
  subjectNumber: number | null;
  headSha: string | null;
  title: string;
  payload: unknown;
  status: string;
  decision: string | null;
  note: string | null;
  telegramMessageId: string | null;
  decidedAt: Date | null;
  createdAt: Date;
};

function toView(row: DecisionRow): DecisionView {
  return {
    id: row.id,
    kind: row.kind,
    subjectType: row.subjectType,
    subjectNumber: row.subjectNumber,
    headSha: row.headSha,
    title: row.title,
    payload: (row.payload as DecisionPayload | null) ?? null,
    status: row.status,
    decision: row.decision,
    note: row.note,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

function cb(id: string, action: string): string {
  return `${DECISION_CALLBACK_PREFIX}:${id}:${action}`;
}

/** Текст и кнопки запроса решения — по kind. */
function buildDecisionMessage(row: DecisionRow): {
  text: string;
  keyboard: { text: string; callback_data: string }[][];
} {
  const payload = (row.payload as DecisionPayload | null) ?? null;
  const subject = row.subjectNumber ? `#${row.subjectNumber}` : '';

  if (row.kind === 'merge-hold') {
    const reasons = (payload?.reasons ?? []).map((r) => `• ${escapeHtml(r)}`).join('\n');
    const link = payload?.url ? `\n<a href="${payload.url}">Открыть PR</a>` : '';
    return {
      text:
        `🔒 <b>PR ${subject} ждёт твоего решения</b>\n` +
        `${escapeHtml(row.title)}\n\n` +
        (reasons ? `Почему не мержится сам:\n${reasons}\n` : '') +
        `\nКоммит: <code>${escapeHtml(row.headSha?.slice(0, 8) ?? '?')}</code>${link}\n\n` +
        `«Мержить» выполнится через ~${GRACE_MINUTES} мин (успеешь отменить), только при зелёном CI и только этот коммит.`,
      keyboard: [
        [
          { text: '✅ Мержить', callback_data: cb(row.id, 'approve') },
          { text: '❌ Отклонить', callback_data: cb(row.id, 'reject') },
        ],
        [{ text: '⏸ Позже', callback_data: cb(row.id, 'defer') }],
      ],
    };
  }

  if (row.kind === 'pat-rotation') {
    return {
      text:
        `🔑 <b>${escapeHtml(row.title)}</b>\n\n` +
        `${escapeHtml(payload?.instructions ?? '')}\n\n` +
        `Это единственное действие в GitHub, которое остаётся за тобой (~2 мин раз в 90 дней).`,
      keyboard: [
        [
          { text: '✅ Готово', callback_data: cb(row.id, 'approve') },
          { text: '⏸ Позже', callback_data: cb(row.id, 'defer') },
        ],
      ],
    };
  }

  // blocked-question и всё прочее — универсальный «вопрос владельцу».
  const detail = payload?.text ? `\n${escapeHtml(payload.text)}\n` : '';
  const link = payload?.url ? `\n<a href="${payload.url}">Подробнее</a>` : '';
  return {
    text:
      `❓ <b>Нужно твоё решение${subject ? ` (${subject})` : ''}</b>\n` +
      `${escapeHtml(row.title)}\n${detail}${link}\n\n` +
      `Детали можно дописать реплаем на это сообщение — текст уйдёт исполнителю.`,
    keyboard: [
      [
        { text: '✅ Да', callback_data: cb(row.id, 'approve') },
        { text: '❌ Нет', callback_data: cb(row.id, 'reject') },
      ],
      [{ text: '⏸ Позже', callback_data: cb(row.id, 'defer') }],
    ],
  };
}

/** Отправка сообщения владельцу; вернёт message_id или null (чат не настроен/Telegram лежит). */
async function sendToOwner(
  text: string,
  keyboard?: { text: string; callback_data: string }[][],
): Promise<string | null> {
  const chatId = ownerChatId();
  if (!chatId) {
    console.warn('[owner-decisions] TELEGRAM_OWNER_CHAT_ID не задан — сообщение не отправлено');
    return null;
  }
  const res = await telegramApi<{ message_id: number }>('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
  if (!res.ok) {
    console.error('[owner-decisions] sendMessage failed:', res.description);
    return null;
  }
  return String(res.result.message_id);
}

/**
 * Запрос решения (идемпотентный upsert). Свипер вызывает это reconcile'ом на
 * каждый needs-owner PR: сообщение владельцу уходит только при реальном
 * создании строки — повторные вызовы возвращают существующую без спама.
 */
export async function createDecisionRequest(
  input: CreateDecisionInput,
): Promise<{ id: string; created: boolean }> {
  if (input.subjectNumber !== null && input.headSha !== null) {
    const existing = await prisma.ownerDecision.findUnique({
      where: {
        kind_subjectNumber_headSha: {
          kind: input.kind,
          subjectNumber: input.subjectNumber,
          headSha: input.headSha,
        },
      },
    });
    if (existing) return { id: existing.id, created: false };
    // Новый head SHA гасит непринятые запросы по тому же subject: владелец не
    // должен отвечать на вопрос про коммит, которого уже нет.
    await prisma.ownerDecision.updateMany({
      where: {
        kind: input.kind,
        subjectNumber: input.subjectNumber,
        status: { in: ['PENDING', 'DEFERRED'] },
        NOT: { headSha: input.headSha },
      },
      data: { status: 'EXPIRED', executorNote: 'superseded: новый head SHA' },
    });
  } else if (input.subjectNumber !== null) {
    // Subject без SHA (blocked-question по issue): unique-ключ с NULL-полем не
    // дедупит (Postgres считает NULL различными) — идемпотентность руками,
    // ПО-СУБЪЕКТНО: один живой запрос на (kind, issue). Дедуп только по kind
    // склеил бы вопросы по разным issues в один.
    const existing = await prisma.ownerDecision.findFirst({
      where: {
        kind: input.kind,
        subjectNumber: input.subjectNumber,
        status: { in: ['PENDING', 'DEFERRED', 'APPROVED'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return { id: existing.id, created: false };
  } else {
    // Kind вообще без subject (pat-rotation): один живой запрос такого kind за раз.
    const existing = await prisma.ownerDecision.findFirst({
      where: { kind: input.kind, status: { in: ['PENDING', 'DEFERRED'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return { id: existing.id, created: false };
  }

  const row = await prisma.ownerDecision.create({
    data: {
      kind: input.kind,
      subjectType: input.subjectType,
      subjectNumber: input.subjectNumber,
      headSha: input.headSha,
      title: input.title,
      payload: input.payload ? JSON.parse(JSON.stringify(input.payload)) : undefined,
    },
  });

  const { text, keyboard } = buildDecisionMessage(row as DecisionRow);
  const messageId = await sendToOwner(text, keyboard);
  if (messageId) {
    await prisma.ownerDecision.update({ where: { id: row.id }, data: { telegramMessageId: messageId } });
  }
  return { id: row.id, created: true };
}

/** APPROVED старше этого порога считается «зависшим» (CI не зеленеет) и показывается владельцу. */
const STUCK_APPROVED_MINUTES = 60;

export async function listDecisions(scope: 'decided' | 'pending' | 'all'): Promise<DecisionView[]> {
  const where =
    scope === 'decided'
      ? { status: { in: ['APPROVED', 'REJECTED'] as ('APPROVED' | 'REJECTED')[] } }
      : scope === 'pending'
        ? {
            // «Ждёт владельца» включает и зависшие APPROVED: аппрув есть, а мерж
            // не случился дольше часа (CI не зеленеет) — иначе владелец получил
            // бы «Принято, мержу» и тишину навсегда.
            OR: [
              { status: { in: ['PENDING', 'DEFERRED'] as ('PENDING' | 'DEFERRED')[] } },
              {
                status: 'APPROVED' as const,
                decidedAt: { lt: new Date(Date.now() - STUCK_APPROVED_MINUTES * 60_000) },
              },
            ],
          }
        : {};
  const rows = await prisma.ownerDecision.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    take: 50,
  });
  return rows.map((r) => toView(r as DecisionRow));
}

async function auditOwnerAction(
  telegramUserId: string,
  action: string,
  decisionId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const user = await prisma.user.findFirst({ where: { telegramId: telegramUserId } });
  if (user) {
    await logAudit(user.id, action, 'OwnerDecision', decisionId, metadata);
  } else {
    // AuditLog.userId — FK на User: без привязанного Telegram-аккаунта владельца
    // писать некуда. След всё равно оставляем — в SystemEvent, чтобы «мутации
    // логируются» не превращалось в тихий console.warn.
    await log.warn(EVENT_SOURCES.OWNER_DECISIONS, `решение владельца без AuditLog: нет User с telegramId`, {
      action,
      decisionId,
      ...metadata,
    });
  }
}

export interface DecideResult {
  ok: boolean;
  error?: string;
  view?: DecisionView;
  /** Готовый короткий ответ для answerCallbackQuery в боте. */
  ack?: string;
}

/** Нажатие кнопки владельцем (бот уже проверил, что это владелец). */
export async function ownerDecide(params: {
  decisionId: string;
  action: DecisionAction;
  note?: string;
  telegramUserId: string;
}): Promise<DecideResult> {
  const row = await prisma.ownerDecision.findUnique({ where: { id: params.decisionId } });
  if (!row) return { ok: false, error: 'решение не найдено' };
  if (row.status === 'EXECUTED' || row.status === 'EXPIRED') {
    return { ok: false, error: `уже ${row.status === 'EXECUTED' ? 'исполнено' : 'устарело'}` };
  }

  if (params.action === 'cancel') {
    if (row.status !== 'APPROVED') return { ok: false, error: 'отменять нечего — аппрува нет' };
    const updated = await prisma.ownerDecision.update({
      where: { id: row.id },
      data: { status: 'PENDING', decision: null, decidedAt: null },
    });
    await auditOwnerAction(params.telegramUserId, 'owner-decision.cancel', row.id, { kind: row.kind, subject: row.subjectNumber });
    return { ok: true, view: toView(updated as DecisionRow), ack: '⏹ Отменено — решение снова ждёт' };
  }

  const status = params.action === 'approve' ? 'APPROVED' : params.action === 'reject' ? 'REJECTED' : 'DEFERRED';
  const updated = await prisma.ownerDecision.update({
    where: { id: row.id },
    data: {
      status,
      decision: params.action,
      decidedAt: new Date(),
      ...(params.note ? { note: params.note } : {}),
    },
  });
  await auditOwnerAction(params.telegramUserId, `owner-decision.${params.action}`, row.id, {
    kind: row.kind,
    subject: row.subjectNumber,
    headSha: row.headSha,
  });

  if (params.action === 'approve' && row.kind === 'merge-hold') {
    await sendToOwner(
      `✅ Принято: мержу PR #${row.subjectNumber} (<code>${escapeHtml(row.headSha?.slice(0, 8) ?? '?')}</code>) ` +
        `через ~${GRACE_MINUTES} мин при зелёном CI.`,
      [[{ text: '⏹ Отменить', callback_data: cb(row.id, 'cancel') }]],
    );
    return { ok: true, view: toView(updated as DecisionRow), ack: `✅ Мерж через ~${GRACE_MINUTES} мин` };
  }
  const ack =
    params.action === 'approve' ? '✅ Принято' : params.action === 'reject' ? '❌ Записал: отклонено' : '⏸ Ок, напомню в вечернем дайджесте';
  return { ok: true, view: toView(updated as DecisionRow), ack };
}

/** Реплай владельца на сообщение решения — содержательная часть ответа. */
export async function attachNote(params: {
  telegramMessageId: string;
  text: string;
  telegramUserId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const row = await prisma.ownerDecision.findFirst({
    where: { telegramMessageId: params.telegramMessageId },
  });
  if (!row) return { ok: false, error: 'это не сообщение решения' };
  if (row.status === 'EXECUTED' || row.status === 'EXPIRED') {
    return { ok: false, error: 'решение уже исполнено — заведи идею («идея: …»), если нужно ещё что-то' };
  }
  const note = row.note ? `${row.note}\n${params.text}` : params.text;
  await prisma.ownerDecision.update({ where: { id: row.id }, data: { note } });
  await auditOwnerAction(params.telegramUserId, 'owner-decision.note', row.id, { kind: row.kind });
  return { ok: true };
}

/**
 * «идея: …» из личного чата — поручение, а не вопрос: сразу APPROVED, свипер
 * превратит в issue (create --dedup-key ownerdec-<id>), приоритет назначит триаж.
 */
export async function createOwnerIdea(params: {
  text: string;
  telegramUserId: string;
}): Promise<{ id: string; created: boolean }> {
  const title = params.text.split('\n')[0].slice(0, 120).trim();
  const existing = await prisma.ownerDecision.findFirst({
    where: { kind: 'owner-idea', title, status: { in: ['PENDING', 'APPROVED'] } },
  });
  if (existing) return { id: existing.id, created: false };
  const row = await prisma.ownerDecision.create({
    data: {
      kind: 'owner-idea',
      subjectType: 'none',
      title,
      payload: { text: params.text },
      status: 'APPROVED',
      decision: 'approve',
      decidedAt: new Date(),
    },
  });
  await auditOwnerAction(params.telegramUserId, 'owner-decision.idea', row.id, { title });
  return { id: row.id, created: true };
}

/** Отчёт исполнения от свипера + подтверждение владельцу. */
export async function markExecutor(params: {
  id: string;
  status: 'EXECUTED' | 'EXPIRED';
  executorNote?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const row = await prisma.ownerDecision.findUnique({ where: { id: params.id } });
  if (!row) return { ok: false, error: 'решение не найдено' };
  await prisma.ownerDecision.update({
    where: { id: params.id },
    data: {
      status: params.status,
      executorNote: params.executorNote,
      ...(params.status === 'EXECUTED' ? { executedAt: new Date() } : {}),
    },
  });
  const subject = row.subjectNumber ? `#${row.subjectNumber}` : row.title;
  if (params.status === 'EXECUTED' && row.status !== 'EXECUTED') {
    await sendToOwner(`☑️ ${escapeHtml(subject)}: ${escapeHtml(params.executorNote ?? 'исполнено')}.`);
  } else if (params.status === 'EXPIRED') {
    await sendToOwner(
      `↩️ Запрос по ${escapeHtml(subject)} устарел (${escapeHtml(params.executorNote ?? 'PR изменился')}) — пришлю новый.`,
    );
  }
  return { ok: true };
}
