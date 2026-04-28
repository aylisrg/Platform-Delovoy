import { NextResponse } from "next/server";
import { log } from "@/lib/logger";
import { redis, redisAvailable } from "@/lib/redis";
import { sendTelegramAlert } from "@/lib/telegram-alert";

/**
 * GET /api/auth/providers-status
 *
 * Returns which auth providers are currently configured so the sign-in UI
 * can hide unavailable options. Alerts admins (Telegram + SystemEvent) when
 * the primary Telegram login channel is misconfigured — the sign-in screen
 * is a top conversion funnel, so silent breakage here is unacceptable.
 *
 * Debounced via Redis to send each alert at most once per hour.
 */

const MISSING_TELEGRAM_ALERT_KEY = "auth:alert:telegram-missing";
const ALERT_COOLDOWN_SECONDS = 60 * 60;

type ProviderStatus = {
  telegram: boolean;
  email: boolean;
  // yandex/google were removed in Wave 1 of the auth refactor (ADR
  // 2026-04-27 §8). Fields kept in the response shape for backwards
  // compatibility with cached front-ends; always false.
  yandex: boolean;
  google: boolean;
  vk: boolean;
};

async function shouldSendAlert(key: string): Promise<boolean> {
  if (!redisAvailable) return true;
  const existing = await redis.get(key);
  if (existing) return false;
  await redis.set(key, "1", "EX", ALERT_COOLDOWN_SECONDS);
  return true;
}

export async function GET() {
  const status: ProviderStatus = {
    telegram: Boolean(
      process.env.NEXT_PUBLIC_TELEGRAM_BOT_NAME && process.env.TELEGRAM_BOT_TOKEN
    ),
    email: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL),
    yandex: false,
    google: false,
    vk: Boolean(process.env.VK_CLIENT_ID && process.env.VK_CLIENT_SECRET),
  };

  if (!status.telegram && (await shouldSendAlert(MISSING_TELEGRAM_ALERT_KEY))) {
    const missing = [
      !process.env.NEXT_PUBLIC_TELEGRAM_BOT_NAME && "NEXT_PUBLIC_TELEGRAM_BOT_NAME",
      !process.env.TELEGRAM_BOT_TOKEN && "TELEGRAM_BOT_TOKEN",
    ]
      .filter(Boolean)
      .join(", ");

    await log.critical(
      "auth",
      "Telegram login provider is misconfigured — sign-in conversion is at risk",
      { missingEnv: missing }
    );
    await sendTelegramAlert(
      `<b>🚨 Логин сломан: Telegram-вход недоступен</b>\nОтсутствуют: <code>${missing}</code>\nКлиенты на экране входа не увидят главную кнопку — это прямая потеря конверсии.`
    );
  }

  return NextResponse.json({ success: true, data: status });
}
