import { prisma } from "@/lib/db";
import { EVENT_SOURCES } from "@/lib/event-sources";
import { redis, redisAvailable } from "@/lib/redis";
import { telegramApi } from "@/lib/telegram/client";

/**
 * Через сколько минут без heartbeat свипера контур owner-decisions считается
 * молчащим.
 *
 * Heartbeat шлёт `issue-queue-merge.yml` по cron раз в 15 минут, но cron в GitHub
 * Actions — best-effort: под нагрузкой планировщик задерживает и пропускает
 * тики, причём для всех workflow репозитория разом. Замер по 799 прогонам
 * свипера за 2026-08-22..09-03: 41 дыра ≥40 мин, 21 ≥1 ч, 11 ≥2 ч,
 * максимум 261 мин (27–28 августа тики шли раз в 3–4 часа весь день);
 * site-watchdog (cron раз в 5 минут) в те же ночные часы молчал синхронно — значит,
 * это планировщик GitHub, а не наш workflow. Прежний порог 40 мин («2–3 тика»)
 * давал ложный CRITICAL владельцу почти каждую ночь (инцидент 2026-09-03,
 * docs/incidents/2026-09-03-owner-decisions-false-stale-alerts.md).
 *
 * 6 часов — худшая наблюдавшаяся дыра ×1.4. Реальная поломка контура
 * (секрет не задан, сайт недоступен из Actions) длится днями, пока её не
 * починят, так что обнаружение за 6 ч вместо 40 мин ничего не теряет.
 */
export const OWNER_DECISIONS_STALE_MINUTES = 6 * 60;

/**
 * Как часто напоминать о продолжающемся молчании. Первый CRITICAL уходит
 * сразу при пересечении порога; пока heartbeat тот же (эпизод не кончился),
 * повтор — не чаще раза в этот интервал. Без этого каждый опрос health
 * (site-watchdog раз в 5 мин) плодил бы по алерту в личку владельца —
 * троттлинг `log.critical()` только 300 с.
 */
const OWNER_DECISIONS_ALERT_REPEAT_SECONDS = 6 * 60 * 60;

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
        const ok = staleMin < OWNER_DECISIONS_STALE_MINUTES;
        ownerDecisionsCheck = {
          ok,
          lastHeartbeatAt: last.createdAt.toISOString(),
          staleMin,
          ...(ok
            ? {}
            : { reason: `heartbeat старше ${OWNER_DECISIONS_STALE_MINUTES} мин` }),
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

/**
 * Слать ли CRITICAL о молчащем контуре именно сейчас. Один алерт на эпизод
 * молчания (ключ — последний heartbeat: новый эпизод → новый ключ → алерт
 * сразу), повтор того же эпизода — раз в OWNER_DECISIONS_ALERT_REPEAT_SECONDS.
 * Redis недоступен или упал — fail-open: лучше лишний алерт, чем потерянный
 * инцидент; шторм тогда всё равно ограничен троттлингом `log.critical()`.
 */
export async function shouldAlertOwnerDecisionsSilence(
  check: NotificationsHealthCheck["checks"]["ownerDecisions"]
): Promise<boolean> {
  if (check.ok) return false;
  if (!redisAvailable) return true;
  try {
    const acquired = await redis.set(
      `owner-decisions:silence-alert:${check.lastHeartbeatAt ?? "never"}`,
      "1",
      "EX",
      OWNER_DECISIONS_ALERT_REPEAT_SECONDS,
      "NX"
    );
    return acquired !== null;
  } catch {
    return true;
  }
}
