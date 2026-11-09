import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { telegramApi } from "@/lib/telegram/client";
import { computeBotStatus, getBotContacts, recordBotBlocked, recordDeliveryProof } from "@/modules/telegram-link/bot-contact";
import { NOTIFICATION_CATALOG } from "./catalog";
import { loadStaffSnapshots } from "./audience";
import { hasEventAccess } from "./subscriptions";
import { classifyTelegramFailure } from "./dispatch/channels/telegram";

/**
 * Разовый анонс команде (ADMIN и SUPERADMIN): «уведомления теперь приходят
 * сюда, лишнее выключайте». Запрос владельца 2026-11-09, ADR
 * `2026-11-09-staff-booking-reports-digest` §5.
 *
 * - Текст собирается по доступу человека: строка категории появляется, только
 *   если он реально может её получать (`hasEventAccess` — тот же резолвер, что
 *   у рассылки и Центра). Суперадмин видит звонки и отчётность, админ — свои
 *   разделы.
 * - Один раз каждому: первичный ключ `NotificationLog.id` (claim) — повторные
 *   прогоны крона и параллельные запуски второе сообщение не шлют.
 * - Только в окне кампании и днём по Москве; после окна модуль инертен и
 *   удаляется следующим PR (правило CLAUDE.md про разовые ops-скрипты).
 * - Только тем, кто запустил бота и не заблокировал его.
 */

export const LAUNCH_ANNOUNCEMENT_EVENT = "system.staff_announcement";
export const LAUNCH_ANNOUNCEMENT_ID = "notifications-launch-2026-11";
/** Кампания открыта до этой даты (UTC) — дальше новых админов не догоняем. */
export const LAUNCH_ANNOUNCEMENT_UNTIL = new Date("2026-11-13T18:00:00Z");
const DAY_FROM_MSK = 9;
const DAY_TO_MSK = 21;
const BATCH_LIMIT = 100;
const ROLES: Role[] = ["SUPERADMIN", "ADMIN"];

export function launchClaimId(userId: string): string {
  return `staff-announce:${LAUNCH_ANNOUNCEMENT_ID}:${userId}`;
}

/** Строка анонса на категорию каталога — только для доступных человеку. */
const CATEGORY_LINES: Record<string, string> = {
  bookings: "📅 <b>Брони</b> — новые, по телефону, переносы, отмены и «скоро закончится»",
  cafe: "☕ <b>Кафе</b> — новые заказы и отмены",
  rental: "🏢 <b>Аренда</b> — новые договоры, заявки и договоры, которые скоро истекают",
  payments: "💳 <b>Платежи</b> — онлайн-оплаты и возвраты",
  avito: "📣 <b>Авито</b> — новые лиды с объявлений",
  reports: "📊 <b>Отчётность</b> — бизнес-итоги недели по понедельникам",
  telephony: "☎️ <b>Звонки</b> — сводка за вчера каждое утро в 09:00",
  system: "🚀 <b>Обновления платформы</b> — коротко о каждом релизе",
};

export function isAnnouncementWindow(now: Date): boolean {
  if (now >= LAUNCH_ANNOUNCEMENT_UNTIL) return false;
  const hourMsk = (now.getUTCHours() + 3) % 24;
  return hourMsk >= DAY_FROM_MSK && hourMsk < DAY_TO_MSK;
}

/** Pure: personalised text from the category keys the person can receive. */
export function buildLaunchAnnouncement(categoryKeys: readonly string[]): string {
  const lines = NOTIFICATION_CATALOG.map((c) => c.key)
    .filter((key) => categoryKeys.includes(key) && CATEGORY_LINES[key])
    .map((key) => CATEGORY_LINES[key]);
  return [
    "🔔 <b>Уведомления Делового теперь приходят сюда</b>",
    "Мы выкатили обновление: всё важное по вашим разделам бот присылает лично, в этот чат. Ничего настраивать не нужно — всё уже включено.",
    lines.join("\n"),
    "💡 По вторникам — короткие подсказки и новости парка.",
    "Если чего-то слишком много — выключите лишнее в Mini App: <b>«Профиль» → «Центр уведомлений»</b>. Там же видно, почему приходит каждое уведомление. Приходит только то, к чему у вас есть доступ.",
    "Хорошей смены! 🌿",
  ].filter(Boolean).join("\n\n");
}

function appUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  return configured?.startsWith("https://") ? configured.replace(/\/$/, "") : "https://delovoy-park.ru";
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
}

export type LaunchResult = { sent: number; failed: number; skipped: number };

/** Called by the five-minute notification cron. */
export async function processStaffLaunchAnnouncement(now = new Date()): Promise<LaunchResult> {
  const result: LaunchResult = { sent: 0, failed: 0, skipped: 0 };
  if (!isAnnouncementWindow(now) || !process.env.TELEGRAM_BOT_TOKEN) return result;

  const users = await prisma.user.findMany({
    where: { role: { in: ROLES }, mergedIntoUserId: null, telegramId: { not: null } },
    select: { id: true, telegramId: true },
    orderBy: { id: "asc" },
  });
  if (users.length === 0) return result;

  const [claims, contacts] = await Promise.all([
    prisma.notificationLog.findMany({ where: { id: { in: users.map((u) => launchClaimId(u.id)) } }, select: { id: true } }),
    getBotContacts(users.map((u) => u.telegramId!)),
  ]);
  const claimed = new Set(claims.map((c) => c.id));
  const pending = users
    .filter((u) => !claimed.has(launchClaimId(u.id)))
    .filter((u) => computeBotStatus(u.telegramId, contacts.get(u.telegramId!), null).state === "STARTED")
    .slice(0, BATCH_LIMIT);
  if (pending.length === 0) return result;

  // Access is re-read from the DB (roles, grants, assignments) — not from a token.
  const snapshots = new Map((await loadStaffSnapshots({ userIds: pending.map((u) => u.id) })).map((s) => [s.id, s]));

  for (const person of pending) {
    const snapshot = snapshots.get(person.id);
    if (!snapshot || !ROLES.includes(snapshot.role) || snapshot.merged) { result.skipped++; continue; }
    const categories = NOTIFICATION_CATALOG
      .filter((c) => c.events.some((e) => hasEventAccess(snapshot, e.eventType)))
      .map((c) => c.key);

    const claimId = launchClaimId(person.id);
    try {
      await prisma.notificationLog.create({
        data: {
          id: claimId, userId: person.id, channel: "TELEGRAM", eventType: LAUNCH_ANNOUNCEMENT_EVENT,
          moduleSlug: "notifications", entityId: LAUNCH_ANNOUNCEMENT_ID, recipient: "self",
          message: "staff-announcement pending", status: "PENDING",
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) { result.skipped++; continue; }
      throw error;
    }

    const res = await telegramApi<{ message_id?: number }>("sendMessage", {
      chat_id: person.telegramId,
      text: buildLaunchAnnouncement(categories),
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: "Настроить уведомления", web_app: { url: `${appUrl()}/webapp/notifications` } }]] },
    });
    if (res.ok) {
      result.sent++;
      await prisma.notificationLog.update({
        where: { id: claimId },
        data: { status: "SENT", sentAt: new Date(), message: `staff-announcement receipt:${res.result?.message_id ?? "?"}` },
      });
      await recordDeliveryProof(person.telegramId!);
    } else {
      result.failed++;
      const code = classifyTelegramFailure(res.description, res.status, res.transportError);
      await prisma.notificationLog.update({ where: { id: claimId }, data: { status: "FAILED", error: code } });
      if (code === "BOT_BLOCKED") await recordBotBlocked(person.telegramId!);
    }
  }
  return result;
}
