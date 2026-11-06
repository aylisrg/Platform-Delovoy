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
 *
 * Одного порога по часам мало: с 2026-11-01 планировщик GitHub запускает все
 * cron-workflow репозитория пачками раз в 4–8 часов (дыры свипера 254–495 мин).
 * Поэтому протухший по часам heartbeat ещё сверяется с тиками планировщика,
 * которые видит сам сайт (`OWNER_DECISIONS_MIN_MISSED_TICKS`, инцидент
 * docs/incidents/2026-11-06-github-cron-degradation.md).
 */
export const OWNER_DECISIONS_STALE_MINUTES = 6 * 60;

/**
 * Сколько тиков планировщика GitHub подряд свипер должен пропустить, чтобы
 * протухший по часам heartbeat считался поломкой контура, а не задержкой cron.
 *
 * Тик — прогон `site-watchdog.yml`: его cron стоит в той же очереди
 * планировщика, что и cron свипера, а опрос этого health он помечает
 * заголовком `X-Delovoy-Probe: site-watchdog` (роут записывает тик через
 * `recordSchedulerTick()`). В обычном режиме тики идут раз в 5 минут, и за 6
 * часов их десятки, так что поведение прежнее. При деградации (2026-11) тики
 * приходят пачками раз в 4–8 часов, и watchdog пачки часто опрашивает health
 * за секунды ДО свипера той же пачки. Если считать по часам, это CRITICAL на
 * каждой пачке, хотя heartbeat придёт через полминуты.
 *
 * Считаем только прошлые тики: текущий опрос записывается после проверки.
 * 0 прошлых тиков после heartbeat означает, что свипер отработал в прошлой
 * пачке после watchdog'а. 1 означает, что он отработал раньше watchdog'а той
 * же пачки или GitHub выронил одну его пачку. 2 и больше значит, что
 * планировщик дважды запускал cron-ы, а свипер не отчитался ни разу: это
 * поломка (секрет, сайт из Actions, сам workflow).
 *
 * Подделка заголовка может только добавить тики, то есть сделать алерт
 * раньше, но не спрятать поломку. Тикам верим, только если список живой и
 * полный (`SCHEDULER_TICK_MAX_AGE_MS`; самый старый тик не новее heartbeat).
 * Иначе молчание самого watchdog'а (workflow выключен, заголовок потерян,
 * cron GitHub встал совсем) неделю прятало бы поломку за старым списком.
 * Тикам не верим (Redis недоступен, список пуст, устарел или неполон) —
 * fail-open: судим только по часам, как до инцидента.
 */
export const OWNER_DECISIONS_MIN_MISSED_TICKS = 2;

/** Заголовок, которым site-watchdog помечает свой опрос как тик планировщика. */
export const SCHEDULER_PROBE_HEADER = "x-delovoy-probe";
export const SCHEDULER_PROBE_VALUE = "site-watchdog";
const SCHEDULER_TICKS_KEY = "notifications:health:scheduler-ticks";
const SCHEDULER_TICK_GUARD_KEY = "notifications:health:scheduler-tick-guard";
const SCHEDULER_TICKS_KEEP = 10;
const SCHEDULER_TICKS_TTL_SECONDS = 7 * 24 * 60 * 60;
/**
 * Повторы внутри одного прогона watchdog'а (вторая попытка через 10 с после
 * не-200) — это тот же тик, а не новый: иначе одна пачка засчитывалась бы
 * дважды и выпавшая пачка свипера сразу давала бы CRITICAL.
 */
const SCHEDULER_TICK_MIN_SPACING_MS = 3 * 60_000;
/**
 * Самый свежий тик старше этого — список тиков мёртвый, им не верим. 12 ч —
 * худшая дыра между пачками 2026-11 (495 мин) ×1.4, тот же запас, что у
 * `OWNER_DECISIONS_STALE_MINUTES`.
 */
const SCHEDULER_TICK_MAX_AGE_MS = 12 * 60 * 60_000;

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

/**
 * Крон process-outgoing считается мёртвым, если он молчит дольше этого порога
 * И при этом есть просроченные сообщения (#917). Раньше `ok` не смотрел ни на
 * cron, ни на очередь: 19 сообщений висели, а health падал только из-за Telegram.
 */
export const OUTGOING_CRON_STALE_MINUTES = 10;

export type NotificationsHealthCheck = {
  ok: boolean;
  /** Telegram-пробы не достучались по транспорту, но серия короче порога — терпим (issue #708). */
  degraded?: { reason: string; flapStreak: number; failedProbes: string[] };
  checks: {
    botToken: { ok: boolean; username?: string; reason?: string; transportError?: boolean };
    adminChat: { ok: boolean; title?: string; reason?: string; transportError?: boolean };
    ownerChat: { ok: boolean; reason?: string; transportError?: boolean };
    queue: { pending: number; failedLastHour: number; overdue?: number };
    cron: { lastRunAt: string | null; staleMin: number; ok?: boolean; reason?: string };
    ownerDecisions: {
      ok: boolean;
      lastHeartbeatAt: string | null;
      staleMin: number;
      reason?: string;
      /** Сколько прошлых тиков планировщика прошло после heartbeat; нет — тики неизвестны. */
      schedulerTicksSinceHeartbeat?: number;
      /** Heartbeat протух по часам, но тиков после него меньше порога: отстаёт cron GitHub, а не контур. */
      schedulerLag?: { lastTickAt: string };
    };
  };
};

/** Прошлые тики планировщика (epoch ms); null — Redis недоступен, упал или тиков ещё нет. */
async function readSchedulerTicks(): Promise<number[] | null> {
  if (!redisAvailable) return null;
  try {
    const raw = await redis.lrange(SCHEDULER_TICKS_KEY, 0, SCHEDULER_TICKS_KEEP - 1);
    const ticks = raw.map(Number).filter((t) => Number.isFinite(t) && t > 0);
    return ticks.length > 0 ? ticks : null;
  } catch {
    return null;
  }
}

/**
 * Записать тик планировщика GitHub (опрос от site-watchdog). Best-effort:
 * без Redis проверка heartbeat просто откатывается к порогу по часам.
 */
export async function recordSchedulerTick(now: number = Date.now()): Promise<void> {
  if (!redisAvailable) return;
  try {
    // Атомарная дедупликация: из параллельных опросов одного прогона тик пишет один.
    const fresh = await redis.set(SCHEDULER_TICK_GUARD_KEY, String(now), "PX", SCHEDULER_TICK_MIN_SPACING_MS, "NX");
    if (fresh === null) return;
    await redis.lpush(SCHEDULER_TICKS_KEY, String(now));
    await redis.ltrim(SCHEDULER_TICKS_KEY, 0, SCHEDULER_TICKS_KEEP - 1);
    await redis.expire(SCHEDULER_TICKS_KEY, SCHEDULER_TICKS_TTL_SECONDS);
  } catch {
    // best-effort: следующий опрос watchdog'а запишет тик снова
  }
}

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
    const overdueBefore = new Date(Date.now() - OUTGOING_CRON_STALE_MINUTES * 60_000);
    const [pending, failedLastHour, overdue] = await Promise.all([
      prisma.outgoingNotification.count({
        where: { status: { in: ["PENDING", "DEFERRED"] } },
      }),
      prisma.outgoingNotification.count({
        where: {
          status: "FAILED",
          updatedAt: { gte: oneHourAgo },
        },
      }),
      prisma.outgoingNotification.count({
        where: { status: { in: ["PENDING", "DEFERRED"] }, scheduledFor: { lte: overdueBefore } },
      }),
    ]);
    queueCheck = { pending, failedLastHour, overdue: overdue ?? 0 };
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
        const heartbeatAt = last.createdAt.getTime();
        const lastHeartbeatAt = last.createdAt.toISOString();
        const staleMin = Math.floor((Date.now() - heartbeatAt) / 60_000);
        if (staleMin < OWNER_DECISIONS_STALE_MINUTES) {
          ownerDecisionsCheck = { ok: true, lastHeartbeatAt, staleMin };
        } else {
          // Протух по часам — сверяемся с тиками планировщика GitHub
          // (см. OWNER_DECISIONS_MIN_MISSED_TICKS).
          const ticks = (await readSchedulerTicks()) ?? [];
          const ticksSince = ticks.filter((t) => t > heartbeatAt).length;
          const lastTickAt = ticks.length > 0 ? Math.max(...ticks) : 0;
          // Список живой (watchdog недавно опрашивал) и полный (видим тики и
          // до heartbeat — иначе после сброса Redis не знаем, сколько их было).
          const ticksTrusted =
            ticks.length > 0 &&
            Date.now() - lastTickAt <= SCHEDULER_TICK_MAX_AGE_MS &&
            Math.min(...ticks) <= heartbeatAt;
          if (ticksTrusted && ticksSince < OWNER_DECISIONS_MIN_MISSED_TICKS) {
            ownerDecisionsCheck = {
              ok: true,
              lastHeartbeatAt,
              staleMin,
              schedulerTicksSinceHeartbeat: ticksSince,
              schedulerLag: { lastTickAt: new Date(lastTickAt).toISOString() },
            };
          } else {
            ownerDecisionsCheck = {
              ok: false,
              lastHeartbeatAt,
              staleMin,
              reason: `heartbeat старше ${OWNER_DECISIONS_STALE_MINUTES} мин`,
              // Число тиков — только когда их хватило для вердикта: «0 раз»
              // от мёртвого списка вводило бы в заблуждение.
              ...(ticksSince >= OWNER_DECISIONS_MIN_MISSED_TICKS
                ? { schedulerTicksSinceHeartbeat: ticksSince }
                : {}),
            };
          }
        }
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

  if ((queueCheck.overdue ?? 0) > 0 && cronCheck.staleMin >= OUTGOING_CRON_STALE_MINUTES) {
    cronCheck = {
      ...cronCheck,
      ok: false,
      reason: `process-outgoing молчит ${cronCheck.lastRunAt ? `${cronCheck.staleMin} мин` : "с момента запуска"}, в очереди ${queueCheck.overdue} просроченных`,
    };
  }
  const cronOk = cronCheck.ok !== false;

  const ok = telegramOk && queueCheck.failedLastHour === 0 && ownerDecisionsCheck.ok && cronOk;

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
