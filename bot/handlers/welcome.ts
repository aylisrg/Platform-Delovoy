import { InlineKeyboard } from "grammy";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const WEBAPP_URL = `${APP_URL}/webapp`;

/**
 * Build the main menu inline keyboard.
 * Exported so it can be reused from welcome / unknown handlers and tests.
 */
export function mainMenuKeyboard() {
  return new InlineKeyboard()
    .webApp("📱 Открыть приложение", WEBAPP_URL)
    .row()
    .text("🏕 Барбекю Парк", "menu:gazebos")
    .text("🎮 Плей Парк", "menu:ps-park")
    .row()
    .text("📋 Мои брони", "menu:my-bookings")
    .row()
    .url("🌐 Открыть сайт", APP_URL);
}

/**
 * Build the welcome message text for /start without deep-link parameters.
 * Personalized with first_name when available.
 */
export function buildWelcomeText(firstName?: string | null): string {
  const userName = firstName?.trim() || "друг";
  return (
    `Привет, ${userName}! 👋\n\n` +
    `Я бот бизнес-парка <b>«Деловой»</b> (Селятино).\n\n` +
    `Через меня можно:\n` +
    `🏕 Забронировать беседку в Барбекю Парке\n` +
    `🎮 Забронировать стол в Плей Парке\n` +
    `📋 Проверить свои бронирования\n\n` +
    `📱 Нажмите <b>«Открыть приложение»</b> — полноценный интерфейс прямо в Telegram!\n\n` +
    `Или выберите, что вас интересует:`
  );
}
