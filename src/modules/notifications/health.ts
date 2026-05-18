import { prisma } from "@/lib/db";

export type NotificationsHealthCheck = {
  ok: boolean;
  checks: {
    botToken: { ok: boolean; username?: string; reason?: string };
    adminChat: { ok: boolean; title?: string; reason?: string };
    ownerChat: { ok: boolean; reason?: string };
    queue: { pending: number; failedLastHour: number };
    cron: { lastRunAt: string | null; staleMin: number };
  };
};

async function probeBot(
  token: string
): Promise<{ ok: boolean; username?: string; reason?: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(5000),
    });
    const json = (await res.json()) as {
      ok: boolean;
      result?: { username: string };
      description?: string;
    };
    if (json.ok) return { ok: true, username: json.result?.username };
    return { ok: false, reason: json.description ?? `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

async function probeChat(
  token: string,
  chatId: string
): Promise<{ ok: boolean; title?: string; reason?: string }> {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(chatId)}`,
      { signal: AbortSignal.timeout(5000) }
    );
    const json = (await res.json()) as {
      ok: boolean;
      result?: { title?: string; first_name?: string };
      description?: string;
    };
    if (json.ok) {
      return {
        ok: true,
        title: json.result?.title ?? json.result?.first_name,
      };
    }
    return { ok: false, reason: json.description ?? `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

export async function notificationsHealth(): Promise<NotificationsHealthCheck> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const adminChatEnv = process.env.TELEGRAM_ADMIN_CHAT_ID;
  const ownerChatId = process.env.TELEGRAM_OWNER_CHAT_ID;

  // Prefer DB-stored chat ID over env (same logic as /api/admin/telegram/test)
  let adminChatId = adminChatEnv;
  try {
    const sys = await prisma.module.findUnique({
      where: { slug: "system" },
      select: { config: true },
    });
    const cfg = (sys?.config as Record<string, unknown>) || {};
    adminChatId = (cfg.telegramAdminChatId as string) || adminChatEnv || "";
  } catch {
    adminChatId = adminChatEnv || "";
  }

  // Bot token check
  let botCheck: NotificationsHealthCheck["checks"]["botToken"];
  if (!token) {
    botCheck = { ok: false, reason: "TELEGRAM_BOT_TOKEN not set" };
  } else {
    botCheck = await probeBot(token);
  }

  // Admin chat check
  let adminChatCheck: NotificationsHealthCheck["checks"]["adminChat"];
  if (!token) {
    adminChatCheck = { ok: false, reason: "bot token missing" };
  } else if (!adminChatId) {
    adminChatCheck = { ok: false, reason: "TELEGRAM_ADMIN_CHAT_ID not set" };
  } else {
    adminChatCheck = await probeChat(token, adminChatId);
  }

  // Owner chat check
  let ownerChatCheck: NotificationsHealthCheck["checks"]["ownerChat"];
  if (!token) {
    ownerChatCheck = { ok: false, reason: "bot token missing" };
  } else if (!ownerChatId) {
    ownerChatCheck = { ok: false, reason: "TELEGRAM_OWNER_CHAT_ID not set" };
  } else {
    const probe = await probeChat(token, ownerChatId);
    ownerChatCheck = { ok: probe.ok, reason: probe.reason };
  }

  // Queue stats
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  let queueCheck: NotificationsHealthCheck["checks"]["queue"] = {
    pending: 0,
    failedLastHour: 0,
  };
  try {
    const [pending, failedLastHour] = await Promise.all([
      prisma.outgoingNotification.count({
        where: { status: { in: ["PENDING", "DEFERRED"] } },
      }),
      prisma.outgoingNotification.count({
        where: {
          status: "FAILED",
          updatedAt: { gte: oneHourAgo },
        },
      }),
    ]);
    queueCheck = { pending, failedLastHour };
  } catch {
    // non-critical — queue stats unavailable
  }

  // Cron heartbeat
  let cronCheck: NotificationsHealthCheck["checks"]["cron"] = {
    lastRunAt: null,
    staleMin: 9999,
  };
  try {
    const last = await prisma.systemEvent.findFirst({
      where: { source: "cron.processOutgoing" },
      orderBy: { createdAt: "desc" },
    });
    if (last) {
      const staleMin = Math.floor(
        (Date.now() - last.createdAt.getTime()) / 60_000
      );
      cronCheck = { lastRunAt: last.createdAt.toISOString(), staleMin };
    }
  } catch {
    // non-critical
  }

  const ok =
    botCheck.ok &&
    adminChatCheck.ok &&
    ownerChatCheck.ok &&
    queueCheck.failedLastHour === 0;

  return { ok, checks: { botToken: botCheck, adminChat: adminChatCheck, ownerChat: ownerChatCheck, queue: queueCheck, cron: cronCheck } };
}
