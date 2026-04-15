import crypto from "crypto";

/**
 * Telegram Mini App — server-side utilities.
 *
 * Validates initData from Telegram WebApp and extracts user info.
 * See: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */

export interface TelegramWebAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
}

export interface ParsedInitData {
  user: TelegramWebAppUser;
  auth_date: number;
  hash: string;
  query_id?: string;
  chat_instance?: string;
  start_param?: string;
}

/**
 * Validate Telegram Mini App initData string.
 *
 * The algorithm:
 * 1. Parse the query string into key-value pairs
 * 2. Remove 'hash' param, sort remaining alphabetically
 * 3. Build check string: "key=value\nkey=value..."
 * 4. Secret key = HMAC-SHA256("WebAppData", bot_token)
 * 5. Compare HMAC-SHA256(secret_key, check_string) with hash
 */
export function validateInitData(initData: string): ParsedInitData | null {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;

  // Check auth_date freshness (max 1 hour)
  const authDate = parseInt(params.get("auth_date") || "0", 10);
  if (Date.now() / 1000 - authDate > 3600) return null;

  // Build check string (sorted, without hash)
  const entries: string[] = [];
  params.forEach((value, key) => {
    if (key !== "hash") entries.push(`${key}=${value}`);
  });
  entries.sort();
  const checkString = entries.join("\n");

  // Secret key = HMAC-SHA256("WebAppData", bot_token)
  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  // Computed hash = HMAC-SHA256(secret_key, check_string)
  const computedHash = crypto
    .createHmac("sha256", secretKey)
    .update(checkString)
    .digest("hex");

  if (computedHash !== hash) return null;

  // Parse user JSON
  const userStr = params.get("user");
  if (!userStr) return null;

  try {
    const user = JSON.parse(userStr) as TelegramWebAppUser;
    return {
      user,
      auth_date: authDate,
      hash,
      query_id: params.get("query_id") || undefined,
      chat_instance: params.get("chat_instance") || undefined,
      start_param: params.get("start_param") || undefined,
    };
  } catch {
    return null;
  }
}
