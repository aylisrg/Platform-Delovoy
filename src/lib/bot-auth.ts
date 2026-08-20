import { timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";

/**
 * Verify that a request comes from the Telegram bot via shared secret header.
 * Constant-time сравнение (паттерн cron/webhook-роутов): среди /api/bot/*
 * теперь есть owner-decisions — контур, управляющий мержем в прод.
 */
export function verifyBotRequest(request: NextRequest): boolean {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return false;

  const authHeader = request.headers.get("x-bot-token") ?? "";
  const a = Buffer.from(authHeader);
  const b = Buffer.from(botToken);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
