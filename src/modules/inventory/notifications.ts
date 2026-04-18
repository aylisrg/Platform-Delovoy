import { prisma } from "@/lib/db";
import { getModuleAdmins } from "@/lib/permissions";
import { telegramAdapter } from "@/modules/notifications/channels/telegram";

const MODULE_NAMES: Record<string, string> = {
  cafe: "Кафе",
  bbq: "Барбекю",
  "ps-park": "PlayStation Park",
};

async function logNotification(
  userId: string | null,
  moduleSlug: string,
  entityId: string,
  recipient: string,
  message: string
) {
  try {
    await prisma.notificationLog.create({
      data: {
        userId,
        channel: "TELEGRAM",
        eventType: "receipt.event",
        moduleSlug,
        entityId,
        recipient,
        message,
        status: "SENT",
        sentAt: new Date(),
      },
    });
  } catch {
    // Non-critical: log failure silently
  }
}

/**
 * Send a Telegram message to all ADMIN users of the given module.
 * Falls back to SUPERADMIN notification chat if no ADMIN is found.
 */
export async function notifyModuleAdmins(
  moduleSlug: string,
  message: string,
  entityId: string
): Promise<void> {
  const admins = await getModuleAdmins(moduleSlug);

  if (admins.length === 0) {
    // No ADMIN assigned — warn via general admin chat
    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (adminChatId) {
      const warning = buildNoAdminWarningMessage(moduleSlug);
      await telegramAdapter.send(adminChatId, warning, {});
    }
    return;
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  for (const admin of admins) {
    if (!admin.telegramId) continue;
    try {
      await telegramAdapter.send(admin.telegramId, message, { botToken: token });
      await logNotification(admin.id, moduleSlug, entityId, admin.telegramId, message);
    } catch (err) {
      console.error(`[inventory/notifications] Failed to notify ADMIN ${admin.id}:`, err);
    }
  }
}

/**
 * Send a Telegram message to a specific user.
 */
export async function notifyUser(
  userId: string,
  moduleSlug: string,
  message: string,
  entityId: string
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { telegramId: true },
  });
  if (!user?.telegramId) return;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  try {
    await telegramAdapter.send(user.telegramId, message, { botToken: token });
    await logNotification(userId, moduleSlug, entityId, user.telegramId, message);
  } catch (err) {
    console.error(`[inventory/notifications] Failed to notify user ${userId}:`, err);
  }
}

// ============================================================
// MESSAGE BUILDERS
// ============================================================

export function buildReceiptCreatedMessage(data: {
  managerName: string;
  itemCount: number;
  totalAmount: string;
  receivedAt: string;
  receiptId: string;
}): string {
  return [
    `<b>Новый приход на склад</b>`,
    ``,
    `Менеджер: <b>${data.managerName}</b>`,
    `Позиций: <b>${data.itemCount}</b>`,
    `Сумма: <b>${data.totalAmount} ₽</b>`,
    `Дата поставки: ${data.receivedAt}`,
    ``,
    `<i>Требует подтверждения.</i>`,
  ].join("\n");
}

export function buildReceiptConfirmedMessage(data: {
  adminName: string;
  receivedAt: string;
}): string {
  return [
    `<b>Приход подтверждён</b>`,
    ``,
    `Ваш приход от ${data.receivedAt} подтверждён.`,
    `Подтвердил: <b>${data.adminName}</b>`,
  ].join("\n");
}

export function buildReceiptProblemMessage(data: {
  managerName: string;
  receivedAt: string;
  problemNote: string;
}): string {
  return [
    `<b>Проблема в приходе</b>`,
    ``,
    `Менеджер: <b>${data.managerName}</b>`,
    `Приход от: ${data.receivedAt}`,
    `Проблема: ${data.problemNote}`,
    ``,
    `<i>Требуется корректировка.</i>`,
  ].join("\n");
}

export function buildReceiptCorrectedMessage(data: {
  adminName: string;
  receivedAt: string;
}): string {
  return [
    `<b>Приход скорректирован</b>`,
    ``,
    `ADMIN <b>${data.adminName}</b> скорректировал ваш приход от ${data.receivedAt}.`,
  ].join("\n");
}

export function buildNoAdminWarningMessage(moduleSlug: string): string {
  const name = MODULE_NAMES[moduleSlug] ?? moduleSlug;
  return [
    `<b>Нет ADMIN в модуле</b>`,
    ``,
    `В модуле "${name}" создан приход, но ADMIN не назначен.`,
    `Требуется назначить ADMIN для проверки приходов.`,
  ].join("\n");
}
