import { InlineKeyboard } from "grammy";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const WEBAPP_URL = `${APP_URL}/webapp`;

/**
 * Build the main menu inline keyboard.
 * Exported so it can be reused from welcome / unknown handlers and tests.
 *
 * @param loginUrl Optional one-time bot→web login URL. When provided, the
 * "🌐 Открыть сайт" button uses it (auto-login flow for returning users).
 * Falls back to the plain APP_URL when the user is not linked or the mint
 * call failed (graceful degradation).
 */
export function mainMenuKeyboard(loginUrl?: string): InlineKeyboard {
  const siteUrl = loginUrl && loginUrl.length > 0 ? loginUrl : APP_URL;
  return new InlineKeyboard()
    .webApp("📱 Открыть приложение", WEBAPP_URL)
    .row()
    .text("🏕 Барбекю Парк", "menu:gazebos")
    .text("🎮 Плей Парк", "menu:ps-park")
    .row()
    .text("📋 Мои брони", "menu:my-bookings")
    .row()
    .url("🌐 Открыть сайт", siteUrl);
}

/**
 * Build the welcome message text for /start without deep-link parameters.
 * Personalized with first_name when available. When `isReturning` is true,
 * we acknowledge the existing link to make the auto-login feel intentional.
 */
export function buildWelcomeText(
  firstName?: string | null,
  isReturning: boolean = false
): string {
  const userName = firstName?.trim() || "друг";
  const greeting = isReturning
    ? `С возвращением, ${userName}! 👋\nТвой аккаунт уже подключён ✓`
    : `Привет, ${userName}! 👋`;
  return (
    `${greeting}\n\n` +
    `Я бот бизнес-парка <b>«Деловой»</b> (Селятино).\n\n` +
    `Через меня можно:\n` +
    `🏕 Забронировать беседку в Барбекю Парке\n` +
    `🎮 Забронировать стол в Плей Парке\n` +
    `📋 Проверить свои бронирования\n\n` +
    `📱 Нажмите <b>«Открыть приложение»</b> — полноценный интерфейс прямо в Telegram!\n\n` +
    `Или выберите, что вас интересует:`
  );
}
