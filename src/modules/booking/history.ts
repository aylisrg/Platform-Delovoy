import type { BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * История событий брони.
 *
 * Отдельной модели `BookingEvent` намеренно нет: `AuditLog` уже пишет
 * завершение, скидку, перенос, чек-ин, no-show и создание — заводить второй
 * журнал значило бы завести второй источник правды и получить ту же беду, что
 * с захардкоженным `["PENDING","CONFIRMED"]` в #424, только с деньгами.
 * Пробел был не в модели, а в полноте (простая отмена не писала причину) и в
 * том, что журнал нигде не показывался администратору.
 */

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  PENDING: "Ожидает",
  CONFIRMED: "Подтверждена",
  CHECKED_IN: "Заезд",
  COMPLETED: "Завершена",
  CANCELLED: "Отменена",
  NO_SHOW: "Неявка",
};

const ACTION_LABELS: Record<string, string> = {
  "booking.create": "Бронь создана",
  "booking.created": "Бронь создана",
  "booking.admin_create": "Бронь создана администратором",
  "booking.confirmed": "Бронь подтверждена",
  "booking.checkin": "Заезд гостя",
  "booking.no_show": "Отмечена неявка",
  "booking.status_change": "Смена статуса",
  "booking.complete": "Бронь завершена",
  "booking.completed": "Бронь завершена",
  "booking.auto_complete": "Бронь завершена автоматически",
  "booking.cancel": "Бронь отменена",
  "booking.cancelled": "Бронь отменена",
  "booking.restore": "Бронь восстановлена",
  "booking.discount_applied": "Применена скидка",
  "booking.reschedule": "Бронь перенесена",
  "booking.extend": "Сессия продлена",
  "booking.add_items": "Добавлены товары",
  "booking.paid": "Получена оплата",
  "booking.deleted": "Бронь удалена",
  "booking.soft_delete": "Бронь удалена",
  "booking.hard_delete": "Бронь удалена безвозвратно",

  // PS Park исторически пишет свои завершение и отмену под префиксом
  // `session.*` — те же события, другое имя. Переименовывать задним числом
  // нельзя: сломаются уже накопленные записи в проде.
  "session.complete": "Сессия завершена",
  "session.auto_complete": "Сессия завершена автоматически",
  "session.cancel": "Сессия отменена",
  "session.items_added_post_complete": "Товары добавлены после завершения",

  "payment.link_created": "Создана ссылка на оплату",
  "notification.overdue.dispatched": "Отправлено напоминание о просрочке",
};

export type BookingHistoryEntry = {
  id: string;
  action: string;
  /** Человекочитаемое «что произошло». */
  label: string;
  /** Кто это сделал: имя менеджера, «Гость» или «Система». */
  actor: string;
  at: string;
  /** Подробности события готовыми строками. */
  details: string[];
};

function formatMoney(value: unknown): string | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return `${Math.round(n).toLocaleString("ru-RU")} ₽`;
}

function statusLabel(value: unknown): string {
  const key = String(value ?? "") as BookingStatus;
  return BOOKING_STATUS_LABELS[key] ?? String(value ?? "—");
}

/**
 * Разворачивает metadata записи журнала в подробности события. Формат
 * metadata у разных действий свой (журнал наполнялся годами разными руками),
 * поэтому читаем по ключам, а не по единой схеме.
 */
function buildDetails(action: string, meta: Record<string, unknown>): string[] {
  const details: string[] = [];

  switch (action) {
    case "booking.status_change": {
      if (meta.previousStatus) {
        details.push(`${statusLabel(meta.previousStatus)} → ${statusLabel(meta.newStatus)}`);
      } else if (meta.newStatus) {
        details.push(`Новый статус: ${statusLabel(meta.newStatus)}`);
      }
      if (meta.reason) details.push(`Причина: ${String(meta.reason)}`);
      break;
    }
    case "booking.complete":
    case "booking.completed":
    case "booking.auto_complete":
    case "session.complete":
    case "session.auto_complete": {
      const total = formatMoney(meta.totalAmount);
      if (total) details.push(`Сумма: ${total}`);
      const cash = Number(meta.cashAmount ?? 0);
      const card = Number(meta.cardAmount ?? 0);
      if (cash > 0) details.push(`Наличные: ${formatMoney(cash)}`);
      if (card > 0) details.push(`Карта: ${formatMoney(card)}`);
      break;
    }
    case "booking.discount_applied": {
      if (meta.discountPercent) details.push(`Скидка ${String(meta.discountPercent)}%`);
      const amount = formatMoney(meta.discountAmount);
      if (amount) details.push(`Минус ${amount}`);
      if (meta.discountReason) details.push(`Причина: ${String(meta.discountReason)}`);
      if (meta.discountNote) details.push(String(meta.discountNote));
      break;
    }
    case "booking.reschedule": {
      if (meta.from && meta.to) details.push(`${String(meta.from)} → ${String(meta.to)}`);
      if (meta.resourceName) details.push(`Ресурс: ${String(meta.resourceName)}`);
      break;
    }
    case "booking.cancel":
    case "booking.cancelled":
    case "session.cancel": {
      if (meta.reason) details.push(`Причина: ${String(meta.reason)}`);
      const penalty = formatMoney(meta.penaltyAmount);
      if (penalty && Number(meta.penaltyAmount) > 0) details.push(`Удержан штраф: ${penalty}`);
      if (meta.source) details.push(`Источник: ${String(meta.source)}`);
      break;
    }
    case "booking.restore": {
      details.push(`${statusLabel(meta.previousStatus)} → ${statusLabel(meta.newStatus)}`);
      if (meta.reason) details.push(`Причина: ${String(meta.reason)}`);
      break;
    }
    case "booking.extend": {
      if (meta.minutes) details.push(`+${String(meta.minutes)} мин`);
      break;
    }
    case "booking.admin_create": {
      if (meta.comment) details.push(`Комментарий: ${String(meta.comment)}`);
      if (meta.email) details.push(`Email: ${String(meta.email)}`);
      break;
    }
    default: {
      if (meta.reason) details.push(`Причина: ${String(meta.reason)}`);
    }
  }

  return details;
}

type ActorSource = {
  userId: string;
  user?: { name: string | null; email: string | null } | null;
  metadata: unknown;
};

/** Кто действовал: имя менеджера, «Система» для крона, «Гость» для клиента. */
function resolveActor(entry: ActorSource, bookingUserId: string | null): string {
  const meta = (entry.metadata ?? {}) as Record<string, unknown>;
  if (meta.actor === "CRON" || meta.source === "cron") return "Система";
  const name = entry.user?.name ?? entry.user?.email;
  if (name) return name;
  if (bookingUserId && entry.userId === bookingUserId) return "Гость";
  return "—";
}

/**
 * Лента событий брони, новые сверху. Права не проверяет — вызывающий роут
 * уже отсёк чужой модуль через `requireAdminSection`.
 */
export async function getBookingHistory(
  bookingId: string,
  moduleSlug: string
): Promise<BookingHistoryEntry[]> {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, moduleSlug },
    select: { id: true, userId: true, createdAt: true, clientName: true },
  });
  if (!booking) return [];

  const logs = await prisma.auditLog.findMany({
    where: { entity: "Booking", entityId: bookingId },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { user: { select: { name: true, email: true } } },
  });

  const entries: BookingHistoryEntry[] = logs.map((entry) => {
    const meta = (entry.metadata ?? {}) as Record<string, unknown>;
    return {
      id: entry.id,
      action: entry.action,
      label: ACTION_LABELS[entry.action] ?? entry.action,
      actor: resolveActor(entry, booking.userId),
      at: entry.createdAt.toISOString(),
      details: buildDetails(entry.action, meta),
    };
  });

  // Синтетическая запись о создании: старые брони заводились до того, как
  // роуты стали писать `booking.create`, и без неё лента начиналась бы с
  // середины. Дубль не создаём — только если создания в журнале нет.
  const hasCreation = entries.some(
    (e) => e.action.startsWith("booking.create") || e.action === "booking.admin_create",
  );
  if (!hasCreation) {
    entries.push({
      id: `synthetic-created-${booking.id}`,
      action: "booking.create",
      label: ACTION_LABELS["booking.create"],
      actor: booking.userId ? "Гость" : "—",
      at: booking.createdAt.toISOString(),
      details: booking.clientName ? [booking.clientName] : [],
    });
  }

  return entries;
}
