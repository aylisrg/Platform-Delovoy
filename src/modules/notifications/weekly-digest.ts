import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { computeAdminSections } from "@/lib/permissions";
import { telegramApi } from "@/lib/telegram/client";
import { escapeHtml as e } from "@/lib/telegram/escape";
import { computeBotStatus, getBotContacts, recordBotBlocked, recordDeliveryProof } from "@/modules/telegram-link/bot-contact";
import { classifyTelegramFailure } from "./dispatch/channels/telegram";
import { RELEASE_EVENT_TYPE } from "./release-notify";
import { CLIENT_TIPS, STAFF_APP_TIPS, sectionTips, type SectionTip, type Tip } from "./weekly-tips";

/**
 * Еженедельные подсказки и обновления от бота Mini App — каждому пользователю,
 * включая гостей (USER). ADR 2026-11-09-staff-booking-reports-digest.
 *
 * Уровни доступа:
 * - гость получает только публичные подсказки и публичные новости парка
 *   (кампании сегмента `all_verified_users` — их и так видит вся лента);
 * - сотрудник дополнительно — подсказку по одному из СВОИХ разделов
 *   (`computeAdminSections`, роль и гранты перечитываются из БД при каждой
 *   рассылке, а не берутся из токена) и список релизов недели, которые
 *   сотрудники и так получают событием `system.release`;
 * - исключённые/влитые аккаунты и те, кто не запускал бота или заблокировал его,
 *   не получают ничего.
 *
 * Отписка — строка `NotificationEventPreference(userId, system.weekly_digest)`
 * с `enabled=false` (тумблер «Подсказки и новости» в Mini App). Тип не в
 * каталоге сотрудников: он общий для всех ролей и не проходит через dispatch().
 *
 * Идемпотентность — первичный ключ `NotificationLog.id = weekly-digest:<user>:<понедельник>`:
 * параллельные прогоны и повторы не шлют второе сообщение за неделю.
 */

export const WEEKLY_DIGEST_EVENT = "system.weekly_digest";

const DAY_MS = 86_400_000;
const MSK_OFFSET_MS = 3 * 3_600_000;
/** Вторник: понедельник занят бизнес-отчётом владельцу. */
const SEND_WEEKDAY = 1; // 0 = понедельник
const SEND_HOUR_MSK = 12;
/** Сообщений за один прогон крона (раз в 5 минут) — бережём лимиты Bot API. */
export const DIGEST_BATCH_LIMIT = 120;
const RUN_BUDGET_MS = 90_000;
const PUBLIC_SEGMENT_KEY = "all_verified_users";
const MAX_NEWS = 3;
const MAX_LINE = 140;

function appUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  // Telegram принимает web_app-кнопки только с https.
  return configured?.startsWith("https://") ? configured.replace(/\/$/, "") : "https://delovoy-park.ru";
}

/**
 * Понедельник (YYYY-MM-DD, МСК) текущей недели, если рассылка этой недели уже
 * открыта (вторник 12:00 МСК — воскресенье), иначе null.
 */
export function digestWeekKey(now: Date): string | null {
  const local = new Date(now.getTime() + MSK_OFFSET_MS);
  const weekday = (local.getUTCDay() + 6) % 7;
  if (weekday < SEND_WEEKDAY || (weekday === SEND_WEEKDAY && local.getUTCHours() < SEND_HOUR_MSK)) return null;
  const monday = new Date(local.getTime() - weekday * DAY_MS);
  return monday.toISOString().slice(0, 10);
}

/** Порядковый номер недели — ротация подсказок без хранения состояния. */
export function weekIndex(weekKey: string): number {
  return Math.floor(Date.parse(`${weekKey}T00:00:00Z`) / (7 * DAY_MS));
}

export function digestClaimId(userId: string, weekKey: string): string {
  return `weekly-digest:${userId}:${weekKey}`;
}

function pick<T>(pool: readonly T[], index: number): T | null {
  if (pool.length === 0) return null;
  return pool[((index % pool.length) + pool.length) % pool.length];
}

function oneLine(text: string): string {
  const line = text
    .split("\n")
    .map((l) => l.replace(/^[#>*\-\s]+/, "").replace(/[*_`]/g, "").trim())
    .find(Boolean) ?? "";
  return line.length > MAX_LINE ? `${line.slice(0, MAX_LINE - 1)}…` : line;
}

function tipBlock(label: string, tip: Tip): string {
  return `${label}\n<b>${e(tip.title)}</b>\n${e(tip.text)}`;
}

export type DigestAudience = {
  role: Role;
  /** Admin sections from `computeAdminSections` — empty for USER. */
  sections: readonly string[];
  /** Explicitly turned off `system.release` — the explicit «off» wins here too. */
  releasesOff?: boolean;
};

export type DigestNews = {
  /** Public park news (segment all_verified_users) — safe for everyone. */
  publicNews: string[];
  /** Platform releases of the week — staff only. */
  releases: string[];
};

/** Pure: the message text for one person. Access rules live here and in the caller. */
export function buildWeeklyDigest(audience: DigestAudience, news: DigestNews, index: number): string {
  const isStaff = audience.role !== "USER";
  const parts: string[] = ["💡 <b>Подсказки недели от Делового</b>"];

  const clientTip = pick(CLIENT_TIPS, index);
  if (clientTip) parts.push(tipBlock("Для вас", clientTip));

  if (isStaff) {
    // Половина недель — подсказка по разделу, половина — по Mini App; если
    // разделов нет, всегда про Mini App. Никогда — про чужой раздел.
    const own = sectionTips(audience.sections);
    const pool: ReadonlyArray<Tip | SectionTip> = own.length > 0 && index % 2 === 0 ? own : STAFF_APP_TIPS;
    const staffTip = pick(pool, Math.floor(index / 2));
    if (staffTip) {
      const label = "sectionTitle" in staffTip ? `Для работы · ${staffTip.sectionTitle}` : "Для работы";
      parts.push(tipBlock(label, staffTip));
    }
  }

  if (news.publicNews.length > 0) {
    parts.push(`📰 <b>Новости парка</b>\n${news.publicNews.slice(0, MAX_NEWS).map((n) => `• ${e(n)}`).join("\n")}`);
  }
  if (isStaff && !audience.releasesOff && news.releases.length > 0) {
    parts.push(`🚀 <b>Обновления платформы за неделю</b>\n${news.releases.slice(0, MAX_NEWS).map((n) => `• ${e(n)}`).join("\n")}`);
  }

  parts.push("Отключить эти сообщения: «Профиль» → «Уведомления и каналы» в Mini App.");
  return parts.join("\n\n");
}

async function loadNews(now: Date): Promise<DigestNews> {
  const since = new Date(now.getTime() - 7 * DAY_MS);
  const [campaigns, releases] = await Promise.all([
    prisma.broadcastCampaign.findMany({
      where: { segmentKey: PUBLIC_SEGMENT_KEY, status: { in: ["running", "completed"] }, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: MAX_NEWS,
      select: { payload: true },
    }),
    prisma.releaseAnnouncement.findMany({
      // Только завершённые анонсы (не processing/retryable/uncertain) — то,
      // что сотрудники уже получили событием system.release.
      where: {
        announcedAt: { gte: since },
        source: { in: ["deploy", "manual", "deploy:complete", "manual:complete"] },
        recipientCount: { gt: 0 },
      },
      orderBy: { announcedAt: "desc" },
      take: MAX_NEWS,
      select: { releaseNotes: true },
    }),
  ]);
  const titleOf = (payload: unknown): string => {
    const p = payload as { title?: unknown } | null;
    return typeof p?.title === "string" ? oneLine(p.title) : "";
  };
  return {
    publicNews: campaigns.map((c) => titleOf(c.payload)).filter(Boolean),
    releases: releases.map((r) => oneLine(r.releaseNotes)).filter(Boolean),
  };
}

type Candidate = { id: string; role: Role; telegramId: string; grants: string[]; releasesOff: boolean };

async function loadCandidates(weekKey: string): Promise<Candidate[]> {
  const users = await prisma.user.findMany({
    where: {
      telegramId: { not: null },
      mergedIntoUserId: null,
      notificationEventPrefs: { none: { eventType: WEEKLY_DIGEST_EVENT, enabled: false } },
    },
    select: {
      id: true, role: true, telegramId: true,
      adminPermissions: { select: { section: true } },
      notificationEventPrefs: { where: { eventType: RELEASE_EVENT_TYPE }, select: { enabled: true } },
    },
    orderBy: { id: "asc" },
  });
  if (users.length === 0) return [];

  const [contacts, claims] = await Promise.all([
    getBotContacts(users.map((u) => u.telegramId!)),
    prisma.notificationLog.findMany({
      where: { id: { in: users.map((u) => digestClaimId(u.id, weekKey)) } },
      select: { id: true },
    }),
  ]);
  const claimed = new Set(claims.map((c) => c.id));
  return users
    .filter((u) => !claimed.has(digestClaimId(u.id, weekKey)))
    // Только те, кто сам запустил бота и не заблокировал его: писать первым
    // Telegram всё равно не даст, а «not started» — не согласие на рассылку.
    .filter((u) => computeBotStatus(u.telegramId, contacts.get(u.telegramId!), null).state === "STARTED")
    .map((u) => ({
      id: u.id, role: u.role, telegramId: u.telegramId!,
      grants: u.adminPermissions.map((p) => p.section),
      releasesOff: u.notificationEventPrefs.some((p) => p.enabled === false),
    }));
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
}

export type DigestRunResult = { weekKey: string | null; sent: number; failed: number; skipped: number; remaining: number };

/** Called by the five-minute notification cron; sends at most one batch per run. */
export async function processWeeklyDigest(now = new Date()): Promise<DigestRunResult> {
  const weekKey = digestWeekKey(now);
  const result: DigestRunResult = { weekKey, sent: 0, failed: 0, skipped: 0, remaining: 0 };
  if (!weekKey || !process.env.TELEGRAM_BOT_TOKEN) return result;

  const candidates = await loadCandidates(weekKey);
  if (candidates.length === 0) return result;
  const news = await loadNews(now);
  const index = weekIndex(weekKey);
  const started = Date.now();
  const batch = candidates.slice(0, DIGEST_BATCH_LIMIT);
  result.remaining = candidates.length - batch.length;

  for (const person of batch) {
    if (Date.now() - started > RUN_BUDGET_MS) {
      result.remaining += batch.length - (result.sent + result.failed + result.skipped);
      break;
    }
    const claimId = digestClaimId(person.id, weekKey);
    try {
      await prisma.notificationLog.create({
        data: {
          id: claimId, userId: person.id, channel: "TELEGRAM", eventType: WEEKLY_DIGEST_EVENT,
          moduleSlug: "notifications", entityId: weekKey, recipient: "self", message: "weekly-digest pending", status: "PENDING",
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) { result.skipped++; continue; }
      throw error;
    }

    const sections = computeAdminSections(person.role, person.grants);
    const text = buildWeeklyDigest({ role: person.role, sections, releasesOff: person.releasesOff }, news, index);
    const res = await telegramApi<{ message_id?: number }>("sendMessage", {
      chat_id: person.telegramId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [
        [{ text: "Открыть Mini App", web_app: { url: `${appUrl()}/webapp` } }],
        [{ text: "Настроить уведомления", web_app: { url: `${appUrl()}/webapp/settings` } }],
      ] },
    });

    if (res.ok) {
      result.sent++;
      await prisma.notificationLog.update({
        where: { id: claimId },
        data: { status: "SENT", sentAt: new Date(), message: `weekly-digest receipt:${res.result?.message_id ?? "?"}` },
      });
      await recordDeliveryProof(person.telegramId);
    } else {
      result.failed++;
      const code = classifyTelegramFailure(res.description, res.status, res.transportError);
      // Повтор на этой неделе не делаем: подсказка — не транзакционное сообщение.
      await prisma.notificationLog.update({ where: { id: claimId }, data: { status: "FAILED", error: code } });
      if (code === "BOT_BLOCKED") await recordBotBlocked(person.telegramId);
    }
  }
  return result;
}
