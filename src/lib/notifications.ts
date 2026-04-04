type AlertLevel = "INFO" | "WARNING" | "ERROR" | "CRITICAL";

const LEVEL_EMOJI: Record<AlertLevel, string> = {
  INFO: "ℹ️",
  WARNING: "⚠️",
  ERROR: "🔴",
  CRITICAL: "🚨",
};

/**
 * Send an alert message to the admin Telegram group via HTTP API.
 * Self-contained — no dependency on the bot process.
 */
async function sendAlert(
  level: AlertLevel,
  source: string,
  message: string,
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

  if (!token || !chatId) {
    console.warn("[Notifications] TELEGRAM_BOT_TOKEN or TELEGRAM_ADMIN_CHAT_ID not set, skipping alert");
    return false;
  }

  const emoji = LEVEL_EMOJI[level];
  const text = [
    `${emoji} <b>[${level}]</b> ${source}`,
    ``,
    message,
    ``,
    `<i>${new Date().toISOString()}</i>`,
  ].join("\n");

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
      }),
    });
    return res.ok;
  } catch (err) {
    console.error("[Notifications] Failed to send Telegram alert:", err);
    return false;
  }
}

export type NotificationChannel = "telegram" | "email";

export type Notification = {
  channel: NotificationChannel;
  recipient: string;
  subject?: string;
  message: string;
};

export async function sendNotification(notification: Notification): Promise<boolean> {
  switch (notification.channel) {
    case "telegram":
      return sendAlert("INFO", "notification", notification.message);
    case "email":
      console.log(`[Email] To: ${notification.recipient} | ${notification.message}`);
      return true;
    default:
      return false;
  }
}

export async function notifyBookingConfirmed(params: {
  userName: string;
  resourceName: string;
  date: string;
  startTime: string;
  endTime: string;
}) {
  const message = [
    `Бронирование подтверждено!`,
    ``,
    `${params.resourceName}`,
    `Дата: ${params.date}`,
    `Время: ${params.startTime} — ${params.endTime}`,
    `Клиент: ${params.userName}`,
  ].join("\n");

  return sendAlert("INFO", "gazebos", message);
}

export async function notifyBookingReminder(params: {
  userName: string;
  resourceName: string;
  date: string;
  startTime: string;
}) {
  const message = [
    `Напоминание о бронировании через 1 час`,
    ``,
    `${params.resourceName}`,
    `Дата: ${params.date}`,
    `Время: ${params.startTime}`,
    `Клиент: ${params.userName}`,
  ].join("\n");

  return sendAlert("INFO", "gazebos", message);
}

export async function notifyNewBooking(params: {
  userName: string;
  resourceName: string;
  date: string;
  startTime: string;
  endTime: string;
}) {
  const message = [
    `Новое бронирование!`,
    ``,
    `${params.resourceName}`,
    `Дата: ${params.date}`,
    `Время: ${params.startTime} — ${params.endTime}`,
    `Клиент: ${params.userName}`,
    ``,
    `Требуется подтверждение.`,
  ].join("\n");

  return sendAlert("INFO", "gazebos", message);
}

export async function notifyBookingCancelled(params: {
  userName: string;
  resourceName: string;
  date: string;
  startTime: string;
  endTime: string;
}) {
  const message = [
    `Бронирование отменено`,
    ``,
    `${params.resourceName}`,
    `Дата: ${params.date}`,
    `Время: ${params.startTime} — ${params.endTime}`,
    `Клиент: ${params.userName}`,
  ].join("\n");

  return sendAlert("WARNING", "gazebos", message);
}
