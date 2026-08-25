import { prisma } from "@/lib/db";
import { EVENT_SOURCES } from "@/lib/event-sources";
import { telegramApi } from "@/lib/telegram/client";

/** Сколько 15-минутных тиков свипера пропустить, прежде чем считать контур молчащим — 2-3 тика + запас на джиттер расписания GitHub Actions. */
const OWNER_DECISIONS_STALE_MINUTES = 40;

export type NotificationsHealthCheck = {
  ok: boolean;
  checks: {
    botToken: { ok: boolean; username?: string; reason?: string };
    adminChat: { ok: boolean; title?: string; reason?: string };
    ownerChat: { ok: boolean; reason?: string };
    queue: { pending: number; failedLastHour: number };
    cron: { lastRunAt: string | null; staleMin: number };
    ownerDecisions: { ok: boolean; lastHeartbeatAt: string | null; staleMin: number; reason?: string };
  };
};

async function probeBot(
  token: string
): Promise<{ ok: boolean; username?: string; reason?: string }> {
  const res = await telegramApi<{ username?: string }>("getMe", undefined, {
    botToken: token,
    timeoutMs: 5000,
  });
  if (res.ok) return { ok: true, username: res.result?.username };
  return { ok: false, reason: res.description };
}

async function probeChat(
  token: string,
  chatId: string
): Promise<{ ok: boolean; title?: string; reason?: string }> {
  const res = await telegramApi<{ title?: string; first_name?: string }>(
    "getChat",
    { chat_id: chatId },
    { botToken: token, timeoutMs: 5000 }
  );
  if (res.ok) {
    return { ok: true, title: res.result?.title ?? res.result?.first_name };
  }
  return { ok: false, reason: res.description };
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

  // Три Telegram-пробы независимы — гоняем их параллельно, а не по очереди.
  // При деградации транспорта (fallback на прямой api.telegram.org —
  // src/lib/telegram/client.ts) каждая проба может занять до своего полного
  // таймаута (5с), и три последовательных прогона подбирались к 15с — почти
  // вплотную к 20-секундному таймауту внешнего probe в site-watchdog.yml.
  // Сам health-чек становился источником ложного HTTP 000 (issue #708,
  // issue #455 п.5), а не только реальная деградация сети.
  const [botCheck, adminChatCheck, ownerProbe] = await Promise.all([
    !token
      ? Promise.resolve<NotificationsHealthCheck["checks"]["botToken"]>({
          ok: false,
          reason: "TELEGRAM_BOT_TOKEN not set",
        })
      : probeBot(token),
    !token
      ? Promise.resolve<NotificationsHealthCheck["checks"]["adminChat"]>({
          ok: false,
          reason: "bot token missing",
        })
      : !adminChatId
        ? Promise.resolve<NotificationsHealthCheck["checks"]["adminChat"]>({
            ok: false,
            reason: "TELEGRAM_ADMIN_CHAT_ID not set",
          })
        : probeChat(token, adminChatId),
    !token
      ? Promise.resolve({ ok: false, reason: "bot token missing" })
      : !ownerChatId
        ? Promise.resolve({ ok: false, reason: "TELEGRAM_OWNER_CHAT_ID not set" })
        : probeChat(token, ownerChatId),
  ]);
  const ownerChatCheck: NotificationsHealthCheck["checks"]["ownerChat"] = {
    ok: ownerProbe.ok,
    reason: ownerProbe.reason,
  };

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

  // Owner-decisions heartbeat — свипер шлёт GET ?status=decided на каждом
  // проходе (decisions-sync), независимо от того, есть ли needs-owner PR.
  // Без этой проверки контур может молчать неделями незамеченным: сама
  // отправка Telegram-кнопок владельцу не проходит ни через один cron/queue
  // check выше (инцидент 2026-08-24 — OWNER_DECISIONS_SECRET не был задан
  // 4 дня, ни один существующий чек этого не поймал).
  let ownerDecisionsCheck: NotificationsHealthCheck["checks"]["ownerDecisions"] = {
    ok: true,
    lastHeartbeatAt: null,
    staleMin: 9999,
  };
  try {
    if (!ownerChatId) {
      // Контур осознанно ещё не настроен (TELEGRAM_OWNER_CHAT_ID не задан) —
      // не должен шуметь до того, как его вообще включили.
      ownerDecisionsCheck = { ok: true, lastHeartbeatAt: null, staleMin: 9999 };
    } else {
      const last = await prisma.systemEvent.findFirst({
        where: { source: EVENT_SOURCES.OWNER_DECISIONS, message: "sweeper heartbeat" },
        orderBy: { createdAt: "desc" },
      });
      if (last) {
        const staleMin = Math.floor((Date.now() - last.createdAt.getTime()) / 60_000);
        ownerDecisionsCheck = {
          ok: staleMin < OWNER_DECISIONS_STALE_MINUTES,
          lastHeartbeatAt: last.createdAt.toISOString(),
          staleMin,
        };
      } else {
        ownerDecisionsCheck = {
          ok: false,
          lastHeartbeatAt: null,
          staleMin: 9999,
          reason: "heartbeat ни разу не зафиксирован",
        };
      }
    }
  } catch {
    // non-critical
  }

  const ok =
    botCheck.ok &&
    adminChatCheck.ok &&
    ownerChatCheck.ok &&
    queueCheck.failedLastHour === 0 &&
    ownerDecisionsCheck.ok;

  return {
    ok,
    checks: {
      botToken: botCheck,
      adminChat: adminChatCheck,
      ownerChat: ownerChatCheck,
      queue: queueCheck,
      cron: cronCheck,
      ownerDecisions: ownerDecisionsCheck,
    },
  };
}
