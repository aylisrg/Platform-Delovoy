import crypto from "crypto";
import { prisma } from "@/lib/db";

/**
 * Tracking links for notification buttons (ADR 2026-10-25-team-access-notifications §Q4).
 *
 * `/r/{code}` — 128-bit random code; the target lives ONLY in
 * `NotificationLink.targetUrl` (no URL ever travels in the link → no open
 * redirect, AC-D3.3) and is allow-listed both when written and when followed.
 * Links survive 400 days so buttons in old messages keep working (AC-D3.8).
 */

export const LINK_TTL_DAYS = 400;
export const LINK_CODE_RE = /^[A-Za-z0-9_-]{22}$/;
const MAX_TARGET_LENGTH = 2048;

export function getAppOrigin(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://delovoy-park.ru";
}

export function getBotUsername(): string {
  return process.env.TELEGRAM_BOT_USERNAME || "DelovoyPark_bot";
}

/** 16 random bytes, base64url → 22 chars. Reveals nothing about user or notification (AC-D3.5). */
export function generateLinkCode(): string {
  return crypto.randomBytes(16).toString("base64url");
}

/**
 * Allow-list: platform pages (relative `/x` or absolute on the platform
 * origin) and links to our own bot on t.me. Anything else → null: the button
 * is dropped instead of being sent clickable.
 */
export function normalizeTrackableTarget(
  raw: unknown,
  opts: { appOrigin: string; botUsername: string },
): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > MAX_TARGET_LENGTH) return null;
  // Backslashes (browsers treat `\` as `/`), control chars and whitespace are never legitimate.
  if (/[\\\s\u0000-\u001F\u007F]/.test(value)) return null;

  let appOrigin: URL;
  try {
    appOrigin = new URL(opts.appOrigin);
  } catch {
    return null;
  }

  let url: URL;
  try {
    if (value.startsWith("/")) {
      if (value.startsWith("//")) return null; // protocol-relative → other host
      url = new URL(value, appOrigin);
    } else {
      url = new URL(value);
    }
  } catch {
    return null;
  }

  if (url.username || url.password) return null;
  const allowedSchemes = appOrigin.protocol === "http:" ? ["https:", "http:"] : ["https:"];
  if (!allowedSchemes.includes(url.protocol)) return null;

  if (url.origin === appOrigin.origin) return url.toString();

  const bot = opts.botUsername.toLowerCase();
  const path = url.pathname.toLowerCase();
  if (url.protocol === "https:" && url.hostname === "t.me" && (path === `/${bot}` || path.startsWith(`/${bot}/`))) {
    return url.toString();
  }
  return null;
}

type ActionInput = { label: string; url?: string; callback?: string };

/**
 * Swap each action URL for a tracking link, idempotently per
 * (chain root, action index) — a fallback delivery reuses the root's codes.
 * Disallowed URLs are dropped (not sent clickable, AC-D3.3).
 */
export async function ensureLinksForDelivery(
  item: { id: string; fallbackOfId: string | null; userId: string; eventType: string },
  actions: ActionInput[] | undefined,
): Promise<Array<{ label: string; url: string; target?: string }>> {
  if (!actions?.length) return [];
  const opts = { appOrigin: getAppOrigin(), botUsername: getBotUsername() };
  const rootId = item.fallbackOfId ?? item.id;
  const origin = new URL(opts.appOrigin).origin;
  const out: Array<{ label: string; url: string; target?: string }> = [];

  for (const [index, action] of actions.entries()) {
    const target = normalizeTrackableTarget(action.url, opts);
    if (!target) continue;
    const link = await prisma.notificationLink.upsert({
      where: { outgoingId_actionIndex: { outgoingId: rootId, actionIndex: index } },
      update: {},
      create: {
        code: generateLinkCode(),
        outgoingId: rootId,
        actionIndex: index,
        userId: item.userId,
        eventType: item.eventType,
        targetUrl: target,
        expiresAt: new Date(Date.now() + LINK_TTL_DAYS * 24 * 60 * 60 * 1000),
      },
      select: { code: true },
    });
    const targetUrl = new URL(target);
    out.push({
      label: action.label,
      url: `${origin}/r/${link.code}`,
      ...(targetUrl.origin === origin ? { target: `${targetUrl.pathname}${targetUrl.search}` } : {}),
    });
  }
  return out;
}

/** Resolve a code for redirect: only stored, unexpired, still-allow-listed targets. */
export async function resolveLinkForRedirect(
  code: string,
  now: Date = new Date(),
): Promise<{ target: string; linkId: string; rootId: string } | null> {
  if (!LINK_CODE_RE.test(code)) return null;
  const link = await prisma.notificationLink.findUnique({
    where: { code },
    select: { id: true, outgoingId: true, targetUrl: true, expiresAt: true },
  });
  if (!link || link.expiresAt <= now) return null;
  // Defense in depth: re-check the stored target against today's allow-list.
  const target = normalizeTrackableTarget(link.targetUrl, { appOrigin: getAppOrigin(), botUsername: getBotUsername() });
  if (!target) return null;
  return { target, linkId: link.id, rootId: link.outgoingId };
}

/** First click time is kept; every click is counted (AC-D3.7). */
export async function recordLinkClick(linkId: string, rootId: string, at: Date = new Date()): Promise<void> {
  await prisma.$transaction([
    prisma.$executeRaw`
      UPDATE "NotificationLink"
      SET "firstClickAt" = COALESCE("firstClickAt", ${at}), "lastClickAt" = ${at}, "clickCount" = "clickCount" + 1
      WHERE "id" = ${linkId}`,
    prisma.$executeRaw`
      UPDATE "OutgoingNotification"
      SET "clickedAt" = COALESCE("clickedAt", ${at}), "clickCount" = "clickCount" + 1
      WHERE "id" = ${rootId}`,
  ]);
}

// Not "telegram"/"yandex": Telegram's in-app browser (Telegram-Android/…) and
// the Yandex app (YandexSearch/…) are real people; their crawlers
// (TelegramBot, YandexBot) are caught by "bot".
const AUTOMATED_UA_RE =
  /(bot|crawl|spider|preview|scan|facebookexternalhit|whatsapp|skype|vkshare|bingpreview|googleimageproxy|curl|wget|python-requests|go-http-client|okhttp|headless)/i;

/** Link previews, scanners, prefetch and HEAD don't count as clicks (AC-D3.6). */
export function isAutomatedRequest(headers: Headers, method: string): boolean {
  if (method.toUpperCase() === "HEAD") return true;
  const ua = headers.get("user-agent")?.trim() ?? "";
  if (!ua || AUTOMATED_UA_RE.test(ua)) return true;
  const purpose = `${headers.get("purpose") ?? ""} ${headers.get("sec-purpose") ?? ""}`.toLowerCase();
  return /prefetch|prerender/.test(purpose);
}
