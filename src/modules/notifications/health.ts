import { prisma } from "@/lib/db";
import { EVENT_SOURCES } from "@/lib/event-sources";
import { redis, redisAvailable } from "@/lib/redis";
import { telegramApi, type TelegramApiResult } from "@/lib/telegram/client";

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

/**
 * Гистерезис транспортных флапов Telegram-проб (issue #708, 37 циклов
 * `notifications-down` за неделю).
 *
 * Замер 2026-09-03 (44 опроса health подряд): в 6 из 44 одна-две из трёх проб
 * (`getMe`, `getChat` админ-группы, `getChat` владельца — каждый раз разные)
 * падали транспортом — `Timeout after 2667ms … UND_ERR_CONNECT_TIMEOUT` — при
 * здоровых БД, очереди и heartbeat. То есть VPS → api.telegram.org рвётся на
 * секунды с вероятностью ~14 % на пробу, а site-watchdog с двумя попытками через
 * 10 с регулярно ловил оба окна и заводил инцидент.
 *
 * Два слоя защиты: (1) повтор пробы внутри запроса — только после
 * транспортного сбоя, ошибки API (`Unauthorized`, `chat not found`) не
 * повторяем, это настоящая поломка; (2) серия подряд опросов, где падали ТОЛЬКО
 * транспортом, считается в Redis — пока серия короче порога, health отдаёт
 * 200 c полем `degraded`, а не 503. Настоящий обрыв (минуты и дольше) набирает
 * порог за ~10 минут опросов watchdog'а и по-прежнему становится инцидентом.
 * Redis недоступен — гистерезиса нет, поведение прежнее (503 сразу).
 */
export const TELEGRAM_TRANSPORT_FLAP_STREAK = 3;
const TELEGRAM_TRANSPORT_FLAP_STREAK_KEY = "notifications:health:telegram-transport-flap-streak";
const TELEGRAM_TRANSPORT_FLAP_STREAK_TTL_SECONDS = 30 * 60;
const TELEGRAM_PROBE_TIMEOUT_MS = 5000;
/**
 * Повтор чуть длиннее первой попытки: при кастомном транспорте telegramApi
 * делит бюджет 8/15 на прокси и остаток на прямой api.telegram.org — у первой
 * попытки на прямой путь остаётся 2.3 с, и он «почти всегда не успевает».
 */
const TELEGRAM_PROBE_RETRY_TIMEOUT_MS = 6000;

export type NotificationsHealthCheck = {
  ok: boolean;
  /** Telegram-пробы не достучались по транспорту, но серия короче порога — терпим (issue #708). */
  degraded?: { reason: string; flapStreak: number; failedProbes: string[] };
  checks: {
    botToken: { ok: boolean; username?: string; reason?: string; transportError?: boolean };
    adminChat: { ok: boolean; title?: string; reason?: string; transportError?: boolean };
    ownerChat: { ok: boolean; reason?: string; transportError?: boolean };
    queue: { pending: number; failedLastHour: number };
    cron: { lastRunAt: string | null; staleMin: number };
    ownerDecisions: { ok: boolean; lastHeartbeatAt: string | null; staleMin: number; reason?: string };
  };
};

/** Одна повторная попытка — только после транспортного сбоя (таймаут/DNS/обрыв). */
async function probeWithRetry<T>(
  call: (timeoutMs: number) => Promise<TelegramApiResult<T>>
): Promise<TelegramApiResult<T>> {
  const first = await call(TELEGRAM_PROBE_TIMEOUT_MS);
  if (first.ok || !first.transportError) return first;
  return call(TELEGRAM_PROBE_RETRY_TIMEOUT_MS);
}

async function probeBot(
  token: string
): Promise<NotificationsHealthCheck["checks"]["botToken"]> {
  const res = await probeWithRetry((timeoutMs) =>
    telegramApi<{ username?: string }>("getMe", undefined, { botToken: token, timeoutMs })
  );
  if (res.ok) return { ok: true, username: res.result?.username };
  return { ok: false, reason: res.description, transportError: res.transportError };
}

async function probeChat(
  token: string,
  chatId: string
): Promise<NotificationsHealthCheck["checks"]["adminChat"]> {
  const res = await probeWithRetry((timeoutMs) =>
    telegramApi<{ title?: string; first_name?: string }>(
      "getChat",
      { chat_id: chatId },
      { botToken: token, timeoutMs }
    )
  );
  if (res.ok) {
    return { ok: true, title: res.result?.title ?? res.result?.first_name };
  }
  return { ok: false, reason: res.description, transportError: res.transportError };
}

/** Длина текущей серии опросов с чисто транспортными сбоями; null — Redis недоступен/упал. */
async function bumpTransportFlapStreak(): Promise<number | null> {
  if (!redisAvailable) return null;
  try {
    const streak = await redis.incr(TELEGRAM_TRANSPORT_FLAP_STREAK_KEY);
    // TTL обновляем на каждом шаге: серия живёт, пока идут опросы; затихшие
    // на полчаса опросы = новая серия.
    await redis.expire(TELEGRAM_TRANSPORT_FLAP_STREAK_KEY, TELEGRAM_TRANSPORT_FLAP_STREAK_TTL_SECONDS);
    return streak;
  } catch {
    return null;
  }
}

async function clearTransportFlapStreak(): Promise<void> {
  if (!redisAvailable) return;
  try {
    await redis.del(TELEGRAM_TRANSPORT_FLAP_STREAK_KEY);
  } catch {
    // best-effort: следующая здоровая проба попробует снова
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
      ? Promise.resolve<NotificationsHealthCheck["checks"]["adminChat"]>({ ok: false, reason: "bot token missing" })
      : !ownerChatId
        ? Promise.resolve<NotificationsHealthCheck["checks"]["adminChat"]>({
            ok: false,
            reason: "TELEGRAM_OWNER_CHAT_ID not set",
          })
        : probeChat(token, ownerChatId),
  ]);
  const ownerChatCheck: NotificationsHealthCheck["checks"]["ownerChat"] = {
    ok: ownerProbe.ok,
    reason: ownerProbe.reason,
    ...(ownerProbe.transportError ? { transportError: true } : {}),
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

  // Гистерезис транспортных флапов (см. TELEGRAM_TRANSPORT_FLAP_STREAK):
  // серия считается только когда ВСЕ упавшие пробы упали транспортом —
  // любая ошибка API (токен отозван, бот выгнан из чата) валит health сразу.
  const probes = [
    { name: "botToken", check: botCheck },
    { name: "adminChat", check: adminChatCheck },
    { name: "ownerChat", check: ownerChatCheck },
  ];
  const failedProbes = probes.filter((p) => !p.check.ok);
  let telegramOk = failedProbes.length === 0;
  let degraded: NotificationsHealthCheck["degraded"];
  if (telegramOk) {
    await clearTransportFlapStreak();
  } else if (failedProbes.every((p) => p.check.transportError)) {
    const streak = await bumpTransportFlapStreak();
    if (streak !== null && streak < TELEGRAM_TRANSPORT_FLAP_STREAK) {
      telegramOk = true;
      degraded = {
        reason:
          `Telegram-проба не достучалась по транспорту (серия ${streak} из ${TELEGRAM_TRANSPORT_FLAP_STREAK}) — ` +
          "кратковременный обрыв VPS → api.telegram.org, терпим",
        flapStreak: streak,
        failedProbes: failedProbes.map((p) => p.name),
      };
    }
  }

  const ok = telegramOk && queueCheck.failedLastHour === 0 && ownerDecisionsCheck.ok;

  return {
    ok,
    ...(degraded ? { degraded } : {}),
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
