import { sendAlert } from "../../bot/index";

export type NotificationChannel = "telegram" | "email";

export type Notification = {
  channel: NotificationChannel;
  recipient: string; // chat_id for telegram, email for email
  subject?: string;
  message: string;
};

/**
 * Send a notification through the specified channel.
 * Currently supports Telegram. Email support planned.
 */
export async function sendNotification(notification: Notification): Promise<boolean> {
  switch (notification.channel) {
    case "telegram":
      return sendAlert("INFO", "notification", notification.message);
    case "email":
      // Email provider to be configured later
      console.log(`[Email] To: ${notification.recipient} | ${notification.message}`);
      return true;
    default:
      return false;
  }
}

/**
 * Send a booking confirmation notification.
 */
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

/**
 * Send a booking reminder (1 hour before).
 */
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

/**
 * Send a new booking notification to managers.
 */
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

/**
 * Send a booking cancellation notification.
 */
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
