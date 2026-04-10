const API_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

/**
 * Make an authenticated request to the bot API.
 */
export async function botFetch(path: string, options?: RequestInit): Promise<Response> {
  const headers = new Headers(options?.headers);
  headers.set("Content-Type", "application/json");
  headers.set("x-bot-token", BOT_TOKEN);

  return fetch(`${API_URL}${path}`, { ...options, headers });
}

export { API_URL };
