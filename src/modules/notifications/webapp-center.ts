import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { WebAppStaffContext } from "@/lib/webapp-auth";
import type { WebAppIconName } from "@/lib/webapp/icon-names";
import { MANAGED_EVENT_TYPES } from "./catalog";
import { explainStaffNotifications, type ExplainEvent } from "./explain";
import { setStaffEventSubscription } from "./subscriptions";
import { NotificationDomainError } from "./errors";
import { getBotUsername } from "./tracking/link-service";
import type { BotStatusDto } from "@/modules/telegram-link/bot-contact";

/**
 * Центр уведомлений сотрудника в Mini App (ADR
 * `2026-08-13-miniapp-role-rebuild` §3.3, §5).
 *
 * Роут только парсит и возвращает — вся логика видимости категорий,
 * автопровижининга канала и записи предпочтений живёт здесь.
 */

export class CenterError extends Error {
  constructor(
    readonly code: "FORBIDDEN" | "VALIDATION_ERROR",
    message: string,
    readonly status: 403 | 422
  ) {
    super(message);
    this.name = "CenterError";
  }
}

export type NotificationCenterChannel = {
  kind: "TELEGRAM";
  status: "active" | "inactive";
  /** Канал создан/верифицирован прямо этим запросом */
  provisionedNow: boolean;
};

export type NotificationCenterEvent = {
  eventType: string;
  label: string;
  description: string;
  /** Effective: the person actually gets it (any path, no opt-out) — AC-C3.1. */
  enabled: boolean;
  /** explicit — есть строка предпочтения; default — строки нет */
  source: "explicit" | "default";
  /** Why it comes: «Вы в списке получателей раздела …», «По роли …», «Личная подписка». */
  caption: string | null;
  blockers: Array<{ code: string; label: string }>;
};

export type NotificationCenterCategory = {
  key: string;
  label: string;
  description: string;
  icon: WebAppIconName;
  delivery: "personal" | "group" | "in-app";
  events: NotificationCenterEvent[];
};

export type NotificationCenterProtectedNotice = {
  label: string;
  note: string;
};

export type NotificationCenterHint = {
  code: "START_BOT" | "UNBLOCK_BOT";
  text: string;
  botUrl?: string;
};

export type NotificationCenterView = {
  role: Role;
  botStatus: BotStatusDto;
  channel: NotificationCenterChannel;
  /** AC-C3.6 — the team lead sees delivery and opens. */
  transparencyNote: string;
  /** AC-C3.4 — no sections yet. */
  emptyState: string | null;
  /** AC-C3.5 — what to do when Telegram can't reach the person. */
  hint: NotificationCenterHint | null;
  categories: NotificationCenterCategory[];
  protected: NotificationCenterProtectedNotice[];
};

export const TRANSPARENCY_NOTE = "Руководитель видит, доставлены ли вам уведомления и открывали ли вы их";
export const EMPTY_STATE = "У вас пока нет разделов. Обратитесь к суперадмину";

/**
 * Неотключаемое — показывается строкой-пояснением в категории «Системные».
 * Инфраструктурные CRITICAL-алерты не проходят через dispatch()/предпочтения
 * физически, тумблера за ними нет и быть не может (AC-5.7).
 */
export const PROTECTED_NOTICES: NotificationCenterProtectedNotice[] = [
  {
    label: "Критические алерты инфраструктуры",
    note: "Приходят всегда и не отключаются",
  },
];

/**
 * Автопровижининг Telegram-канала при входе в Центр (ADR §5, AC-5.6).
 *
 * Право писать адрес даёт подписанный Telegram initData: подпись HMAC-SHA256
 * покрывает `user.id`, проверяется timing-safe, окно `auth_date` — час.
 * Это строго сильнее OTP-цикла, который здесь заменяется.
 *
 * Читаем все TELEGRAM-каналы пользователя одним запросом: так отличается
 * «канала нет» от «канал есть, но под старым telegramId» (для второго —
 * заводим строку под текущий адрес, старую не трогаем).
 */
export async function ensureTelegramChannel(
  userId: string,
  telegramId: string | null
): Promise<NotificationCenterChannel> {
  // Без telegramId адресовать нечего — Центр работает, но канал не заводим.
  if (!telegramId) {
    return { kind: "TELEGRAM", status: "inactive", provisionedNow: false };
  }

  const channels = await prisma.userNotificationChannel.findMany({
    where: { userId, kind: "TELEGRAM" },
    select: { id: true, address: true, isActive: true, verifiedAt: true },
  });

  const existing = channels.find((c) => c.address === telegramId);

  if (!existing) {
    try {
      await prisma.userNotificationChannel.create({
        data: {
          userId,
          kind: "TELEGRAM",
          address: telegramId,
          label: "Telegram",
          // Ниже дефолтных 100 — Telegram становится основным каналом
          // сотрудника, открывшего Центр из Telegram.
          priority: 10,
          isActive: true,
          verifiedAt: new Date(),
        },
      });
      return { kind: "TELEGRAM", status: "active", provisionedNow: true };
    } catch (err) {
      // Гонка двух параллельных открытий Центра: уникальный ключ
      // (userId, kind, address) уже занят — канал есть, всё в порядке.
      if (isUniqueViolation(err)) {
        return { kind: "TELEGRAM", status: "active", provisionedNow: false };
      }
      throw err;
    }
  }

  // Деактивация — явное решение пользователя/админа: не реактивируем,
  // UI просит включить канал осознанно.
  if (!existing.isActive) {
    return { kind: "TELEGRAM", status: "inactive", provisionedNow: false };
  }

  if (existing.verifiedAt === null) {
    await prisma.userNotificationChannel.update({
      where: { id: existing.id },
      data: { verifiedAt: new Date() },
    });
    return { kind: "TELEGRAM", status: "active", provisionedNow: true };
  }

  // Верифицированный активный канал — идемпотентно ничего не делаем.
  return { kind: "TELEGRAM", status: "active", provisionedNow: false };
}

/**
 * Гость в Центре не бывает: роут отсекает USER ещё в `loadWebAppStaff`.
 * Дублируем проверку в сервисе — второй вызывающий не должен уметь обойти
 * её случайно (и канал гостю никто не провижинит).
 */
function assertStaff(staff: WebAppStaffContext): void {
  if (staff.role === "USER") {
    throw new CenterError(
      "FORBIDDEN",
      "Центр уведомлений доступен только сотрудникам",
      403
    );
  }
}

function eventCaption(event: ExplainEvent): string | null {
  if (!event.toggle.enabled) return null;
  const list = event.paths.find((p) => p.kind === "module_list");
  if (list) return list.label.replace("Список получателей раздела", "Вы в списке получателей раздела");
  if (event.paths.some((p) => p.kind === "role_avito")) return "По роли: суперадмины и назначенные на модуль";
  if (event.paths.some((p) => p.kind === "in_app_superadmin")) return "В ленте Mini App";
  if (event.paths.some((p) => p.kind === "personal")) return "Личная подписка";
  return null;
}

function botHint(botStatus: BotStatusDto): NotificationCenterHint | null {
  const botUrl = `https://t.me/${getBotUsername()}`;
  if (botStatus.state === "NOT_STARTED") {
    return { code: "START_BOT", text: "Запустите бота (нажмите Start), иначе сообщения в Telegram не приходят", botUrl };
  }
  if (botStatus.state === "BLOCKED") {
    return { code: "UNBLOCK_BOT", text: "Бот заблокирован — разблокируйте его в Telegram", botUrl };
  }
  return null;
}

/**
 * Состояние Центра для сотрудника. Тумблер — эффективный («получаю ли я»),
 * посчитанный той же функцией, что реальная рассылка (ADR 2026-10-25 §Q7):
 * участник списка раздела видит «Вкл» с подписью, «Выкл» реально прекращает
 * доставку (AC-C3.1). Категории — только с доступом (без «grandfather»).
 */
export async function getNotificationCenter(
  staff: WebAppStaffContext,
  telegramId: string | null
): Promise<NotificationCenterView> {
  assertStaff(staff);

  // Channel first: opening the Center may provision Telegram, which the
  // explanation below must already see.
  const channel = await ensureTelegramChannel(staff.id, telegramId);
  const explain = (await explainStaffNotifications([staff.id])).get(staff.id);
  if (!explain) {
    throw new CenterError("FORBIDDEN", "Центр уведомлений доступен только сотрудникам", 403);
  }

  const categories = explain.categories
    .filter((category) => category.access.ok)
    .map<NotificationCenterCategory>((category) => {
      const events = category.events.map<NotificationCenterEvent>((event) => ({
        eventType: event.eventType,
        label: event.label,
        description: event.description,
        enabled: event.toggle.enabled,
        source: event.toggle.source,
        caption: eventCaption(event),
        blockers: event.blockers,
      }));
      return {
        key: category.key,
        label: category.label,
        description: category.description,
        icon: category.icon as WebAppIconName,
        delivery: category.delivery === "in-app" ? "in-app" : events.some((e) => e.enabled) ? "personal" : "group",
        events,
      };
    });

  return {
    role: staff.role,
    botStatus: explain.botStatus,
    channel,
    transparencyNote: TRANSPARENCY_NOTE,
    emptyState: categories.length === 0 ? EMPTY_STATE : null,
    hint: botHint(explain.botStatus),
    categories,
    protected: PROTECTED_NOTICES,
  };
}

/**
 * Переключение одного типа уведомления сотрудником — тот же путь записи, что
 * у суперадмина на странице сотрудника (AC-C2.2), с журналом (via miniapp).
 */
export async function setEventPreference(
  staff: WebAppStaffContext,
  eventType: string,
  enabled: boolean
): Promise<{ eventType: string; enabled: boolean }> {
  assertStaff(staff);

  if (!(MANAGED_EVENT_TYPES as readonly string[]).includes(eventType)) {
    throw new CenterError("VALIDATION_ERROR", "Неизвестный тип уведомления", 422);
  }

  try {
    const result = await setStaffEventSubscription({
      targetUserId: staff.id,
      eventType,
      enabled,
      actor: { userId: staff.id, via: "miniapp" },
    });
    return { eventType: result.eventType, enabled: result.enabled };
  } catch (error) {
    if (error instanceof NotificationDomainError) {
      if (error.code === "UNKNOWN_EVENT") throw new CenterError("VALIDATION_ERROR", error.message, 422);
      throw new CenterError("FORBIDDEN", "Нет доступа к этой категории уведомлений", 403);
    }
    throw error;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}
