import { prisma } from "@/lib/db";
import { log } from "@/lib/logger";
import { dispatch } from "./dispatch/dispatcher";

/** Единственный тип события релиза. `system.deploy` сознательно не вводится (ADR §4). */
export const RELEASE_EVENT_TYPE = "system.release";

export interface ReleaseInfo {
  version: string;
  releaseNotes: string;
  commitSha: string;
  deployedAt: string;
}

export type AnnounceReleaseResult =
  | { status: "announced"; queued: number }
  | { status: "skipped"; reason: "already-announced" };

/** Prisma P2002 — нарушение уникальности (здесь: версия уже анонсирована). */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

/**
 * Анонс релиза подписчикам — ровно один раз на версию.
 *
 * Идемпотентность серверная: claim строки `ReleaseAnnouncement` (PK = version)
 * через `create`. Выиграл INSERT — отправляем; получили P2002 — версия уже
 * анонсирована, молча выходим (второй параллельный прогон деплоя, повторный
 * запуск workflow, ре-деплой того же тега). Любая другая ошибка — fail-open:
 * молчание о реальном релизе хуже редкого дубля, второй эшелон защиты —
 * 5-минутный dedupKey внутри dispatch().
 *
 * ADR docs/architecture/2026-08-13-miniapp-role-rebuild-adr.md §6.
 */
export async function announceRelease(
  info: ReleaseInfo
): Promise<AnnounceReleaseResult> {
  let claimed = false;

  try {
    await prisma.releaseAnnouncement.create({
      data: {
        version: info.version,
        commitSha: info.commitSha,
        releaseNotes: info.releaseNotes,
        announcedAt: new Date(),
        source: "deploy",
      },
    });
    claimed = true;
  } catch (err) {
    if (isUniqueViolation(err)) {
      await log.info(
        "release-notify",
        `Релиз v${info.version} уже анонсирован — повторная отправка заблокирована`,
        { version: info.version, commitSha: info.commitSha }
      );
      return { status: "skipped", reason: "already-announced" };
    }

    await log.warn(
      "release-notify",
      `Проверка идемпотентности релиза v${info.version} не выполнена — отправляем (fail-open)`,
      { version: info.version, error: String(err) }
    );
    // fail-open: проваливаемся дальше и всё равно отправляем
  }

  const userIds = await resolveReleaseAudience();
  const payload = buildReleasePayload(info);

  const outcomes = await Promise.allSettled(
    userIds.map((userId) =>
      dispatch({
        userId,
        eventType: RELEASE_EVENT_TYPE,
        entityType: "Release",
        entityId: info.version,
        payload,
      })
    )
  );

  let queued = 0;
  for (const outcome of outcomes) {
    if (outcome.status === "rejected") {
      console.error("[ReleaseNotify] dispatch failed:", outcome.reason);
      continue;
    }
    if (outcome.value.status !== "skipped") queued++;
  }

  if (claimed) {
    try {
      await prisma.releaseAnnouncement.update({
        where: { version: info.version },
        data: { recipientCount: queued },
      });
    } catch (err) {
      // Учёт получателей — справочная величина: анонс уже разослан,
      // ронять релиз из-за неё нельзя.
      console.error("[ReleaseNotify] failed to store recipientCount:", err);
    }
  }

  // Аудит мутации: сам факт анонса + сколько уведомлений встало в очередь.
  // Долговечный след содержания релиза — строка ReleaseAnnouncement.
  await log.info(
    "release-notify",
    `Релиз v${info.version} анонсирован подписчикам: ${queued} из ${userIds.length}`,
    { version: info.version, commitSha: info.commitSha, queued, audience: userIds.length }
  );

  return { status: "announced", queued };
}

/**
 * Аудитория релиза — только явные персональные подписки (принцип ADR §3.3:
 * отсутствие строки ≠ подписка). Фильтр по роли — чтобы разжалованный
 * сотрудник перестал получать релизы немедленно, не дожидаясь чистки строк;
 * слитые (`mergedIntoUserId`) аккаунты исключаются вместе с ними.
 */
export async function resolveReleaseAudience(): Promise<string[]> {
  const rows = await prisma.notificationEventPreference.findMany({
    where: {
      eventType: RELEASE_EVENT_TYPE,
      enabled: true,
      user: { role: { not: "USER" }, mergedIntoUserId: null },
    },
    select: { userId: true },
  });

  return rows.map((row) => row.userId);
}

/**
 * Список сотрудников и их состояние подписки на релизы для админки.
 * Источник правды — `NotificationEventPreference`; отсутствие строки = не подписан.
 */
export async function getReleaseSubscribers(): Promise<
  Array<{ id: string; notifyReleases: boolean }>
> {
  const users = await prisma.user.findMany({
    where: { role: { not: "USER" }, mergedIntoUserId: null },
    select: {
      id: true,
      notificationEventPrefs: {
        where: { eventType: RELEASE_EVENT_TYPE },
        select: { enabled: true },
      },
    },
  });

  return users.map((u) => ({
    id: u.id,
    notifyReleases: u.notificationEventPrefs[0]?.enabled ?? false,
  }));
}

/**
 * Единственный путь записи подписки на релизы (ADR §6.4).
 *
 * Пишет обе записи: `NotificationEventPreference` — источник правды доставки,
 * легаси-колонка `NotificationPreference.notifyReleases` — зеркало для списка
 * пользователей в `/admin/users`, который читает колонку напрямую. Одна
 * функция — один путь записи, дрейфа между источниками нет.
 */
export async function setReleaseSubscription(
  userId: string,
  enabled: boolean
): Promise<void> {
  await prisma.notificationEventPreference.upsert({
    where: { userId_eventType: { userId, eventType: RELEASE_EVENT_TYPE } },
    create: { userId, eventType: RELEASE_EVENT_TYPE, enabled },
    update: { enabled },
  });

  await prisma.notificationPreference.upsert({
    where: { userId },
    create: { userId, notifyReleases: enabled },
    update: { notifyReleases: enabled },
  });
}

/**
 * Легаси-имя того же действия. Сохранено для существующих импортёров
 * (`PATCH /api/users/:id/notify-releases`), чтобы путь записи остался один.
 */
export const setReleaseNotifyPreference = setReleaseSubscription;

/**
 * Гарантирует, что новый MANAGER/SUPERADMIN подписан на релизы и достижим:
 * строка `system.release` + легаси-строка предпочтений + Telegram-канал
 * доставки при наличии `telegramId`.
 *
 * Идемпотентно и строго create-only: существующая отписка (`enabled: false`)
 * и настройки уже заведённого канала не затираются.
 */
export async function ensureManagerNotifyDefaults(userId: string): Promise<void> {
  await prisma.notificationPreference.upsert({
    where: { userId },
    create: { userId, notifyReleases: true },
    update: {}, // do not clobber an existing preference
  });

  await prisma.notificationEventPreference.upsert({
    where: { userId_eventType: { userId, eventType: RELEASE_EVENT_TYPE } },
    create: { userId, eventType: RELEASE_EVENT_TYPE, enabled: true },
    update: {}, // do not clobber an existing opt-out
  });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { telegramId: true },
  });
  if (!user?.telegramId) return;

  await prisma.userNotificationChannel.upsert({
    where: {
      userId_kind_address: {
        userId,
        kind: "TELEGRAM",
        address: user.telegramId,
      },
    },
    create: {
      userId,
      kind: "TELEGRAM",
      address: user.telegramId,
      label: "Telegram",
      priority: 10,
      isActive: true,
      verifiedAt: new Date(),
    },
    update: {}, // канал уже заведён — не реактивируем и не переверифицируем
  });
}

// ─── Formatter ──────────────────────────────────────────────────────────────

function buildReleasePayload(info: ReleaseInfo): {
  title: string;
  body: string;
  actions: Array<{ label: string; url: string }>;
} {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://delovoy-park.ru";
  return {
    title: `🚀 Релиз v${info.version}`,
    body: formatReleaseBody(info),
    actions: [{ label: "Changelog", url: `${appUrl}/admin/monitoring` }],
  };
}

/** Plain text: Telegram-канал сам экранирует HTML и выделяет заголовок. */
function formatReleaseBody(info: ReleaseInfo): string {
  const shortSha = info.commitSha.slice(0, 7);
  const parsed = new Date(info.deployedAt);
  const date = Number.isNaN(parsed.getTime())
    ? ""
    : parsed.toLocaleString("ru-RU", {
        timeZone: "Europe/Moscow",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

  const head = date
    ? `📅 ${date} МСК  |  🔗 ${shortSha}`
    : `🔗 ${shortSha}`;

  const notes = info.releaseNotes.trim();
  return notes ? `${head}\n\nЧто выкатилось:\n${notes}` : head;
}
