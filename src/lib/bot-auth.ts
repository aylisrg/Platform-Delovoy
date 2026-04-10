import { NextRequest } from "next/server";

/**
 * Verify that a request comes from the Telegram bot via shared secret header.
 */
export function verifyBotRequest(request: NextRequest): boolean {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return false;

  const authHeader = request.headers.get("x-bot-token");
  return authHeader === botToken;
}
