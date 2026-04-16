import { prisma } from "@/lib/db";
import { telegramAdapter } from "./channels/telegram";

export interface ReleaseInfo {
  version: string;
  releaseNotes: string;
  commitSha: string;
  deployedAt: string;
}

/**
 * Send a release notification via Telegram to all SUPERADMIN/MANAGER users
 * who have opted in (notificationPreference.notifyReleases = true).
 *
 * Called by the CI/CD deploy pipeline after a successful production deploy.
 */
export async function sendReleaseNotification(info: ReleaseInfo): Promise<{
  sent: number;
  failed: number;
  skipped: number;
}> {
  const subscribers = await prisma.user.findMany({
    where: {
      role: { in: ["SUPERADMIN", "MANAGER"] },
      telegramId: { not: null },
      notificationPreference: {
        notifyReleases: true,
      },
    },
    select: {
      id: true,
      telegramId: true,
    },
  });

  if (subscribers.length === 0) {
    return { sent: 0, failed: 0, skipped: 0 };
  }

  const message = formatReleaseMessage(info);

  let sent = 0;
  let failed = 0;

  const results = await Promise.allSettled(
    subscribers.map(async (user) => {
      const result = await telegramAdapter.send(user.telegramId!, message);
      if (!result.success) {
        throw new Error(result.error ?? "Unknown Telegram error");
      }
    })
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      sent++;
    } else {
      failed++;
      console.error("[ReleaseNotify] Failed to send to a subscriber:", result.reason);
    }
  }

  return { sent, failed, skipped: 0 };
}

/**
 * Get all SUPERADMIN/MANAGER users with their release-notify preference.
 * Used to display the toggle state in the admin panel.
 */
export async function getReleaseSubscribers(): Promise<
  Array<{ id: string; notifyReleases: boolean }>
> {
  const users = await prisma.user.findMany({
    where: { role: { in: ["SUPERADMIN", "MANAGER"] } },
    select: {
      id: true,
      notificationPreference: {
        select: { notifyReleases: true },
      },
    },
  });

  return users.map((u) => ({
    id: u.id,
    notifyReleases: u.notificationPreference?.notifyReleases ?? false,
  }));
}

/**
 * Set the release notification preference for a single user.
 */
export async function setReleaseNotifyPreference(
  userId: string,
  enabled: boolean
): Promise<void> {
  await prisma.notificationPreference.upsert({
    where: { userId },
    create: { userId, notifyReleases: enabled },
    update: { notifyReleases: enabled },
  });
}

// ─── Formatter ──────────────────────────────────────────────────────────────

function formatReleaseMessage(info: ReleaseInfo): string {
  const shortSha = info.commitSha.slice(0, 7);
  const date = new Date(info.deployedAt).toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const notes = info.releaseNotes.trim();
  const notesSection = notes
    ? `\n\n<b>Что выкатилось:</b>\n${notes}`
    : "";

  return (
    `🚀 <b>Новый релиз v${info.version}</b>\n` +
    `📅 ${date} МСК  |  🔗 <code>${shortSha}</code>` +
    notesSection
  );
}
