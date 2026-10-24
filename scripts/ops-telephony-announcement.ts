/** One-off, owner-requested Telegram news. Preview is the default; never retries a send. */
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { fetch as proxyFetch, ProxyAgent } from "undici";
import { isInQuietHours } from "../src/modules/notifications/dispatch/quiet-hours";

export const CAMPAIGN = "telephony-daily-summary-2026-10-24";
export const MESSAGE = [
  "📞 В Delovoy появилась ежедневная статистика звонков!",
  "",
  "После 09:00 МСК в мини-приложении — сводка за вчера: всего звонков, принято и пропущено.",
  "",
  "Подробности — в админке, раздел «Телефония»: динамика за день, 7 и 30 дней и журнал звонков.",
  "",
  "Сейчас статистика и ежедневная сводка доступны владельцу с ролью SUPERADMIN.",
].join("\n");

const select = {
  id: true, role: true, mergedIntoUserId: true, telegramId: true,
  notificationChannels: { where: { kind: "TELEGRAM" as const }, orderBy: { priority: "asc" as const } },
  notificationGlobalPref: true,
  notificationEventPrefs: { where: { eventType: "system.release" } },
} satisfies Prisma.UserSelect;
export type AudienceUser = Prisma.UserGetPayload<{ select: typeof select }>;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const deliveryId = (address: string) => `${CAMPAIGN}:${hash(address)}`;

export function recipientAddress(user: AudienceUser, now: Date): string | null {
  if (!["ADMIN", "SUPERADMIN"].includes(user.role) || user.mergedIntoUserId) return null;
  const global = user.notificationGlobalPref;
  const pref = user.notificationEventPrefs[0];
  if (pref?.enabled === false || (pref?.dndUntil ?? global?.dndUntil ?? now) > now) return null;
  if (isInQuietHours(now, {
    from: pref?.quietHoursFrom ?? global?.quietHoursFrom ?? null,
    to: pref?.quietHoursTo ?? global?.quietHoursTo ?? null,
    timezone: pref?.timezone ?? global?.timezone ?? "Europe/Moscow",
    weekdaysOnly: pref?.quietWeekdaysOnly ?? false,
  })) return null;
  // Existing inactive/unverified channels must not be bypassed by legacy telegramId.
  const address = user.notificationChannels.length
    ? user.notificationChannels.find(channel => channel.isActive && channel.verifiedAt)?.address
    : user.telegramId;
  return address && /^[1-9]\d{0,19}$/.test(address) ? address : null;
}

export function audience(users: AudienceUser[], now: Date) {
  const addresses = new Set<string>();
  return users.flatMap(user => {
    const address = recipientAddress(user, now);
    if (!address || addresses.has(address)) return [];
    addresses.add(address);
    return [{ userId: user.id, role: user.role, address }];
  }).sort((a, b) => a.userId.localeCompare(b.userId));
}

const telegramResponse = z.object({
  ok: z.boolean(),
  result: z.unknown().optional(),
  error_code: z.number().optional(),
});
const messageResult = z.object({ message_id: z.number().int(), chat: z.object({ id: z.number(), type: z.literal("private") }) });
type TelegramCall = (method: string, payload: Record<string, unknown>) => Promise<z.infer<typeof telegramResponse>>;

/** Probe with read-only getMe; pin one working route before any sendMessage. */
export async function chooseTransport(configured: TelegramCall, direct: TelegramCall, hasCustomTransport: boolean) {
  const routes = hasCustomTransport
    ? [{ name: "configured", call: configured }, { name: "direct", call: direct }]
    : [{ name: "direct", call: direct }];
  for (const route of routes) {
    let identity: Awaited<ReturnType<TelegramCall>>;
    try { identity = await route.call("getMe", {}); } catch { continue; }
    if (!identity.ok) continue;
    const bot = z.object({ id: z.number(), username: z.string() }).safeParse(identity.result);
    if (!bot.success) continue;
    if (bot.data.username.toLowerCase() !== "delovoypark_bot") throw new Error("UNEXPECTED_BOT");
    return {
      name: route.name,
      bot: bot.data.username,
      call: ((method, payload) => method === "getMe" ? Promise.resolve(identity) : route.call(method, payload)) as TelegramCall,
    };
  }
  throw new Error("TELEGRAM_UNREACHABLE");
}

export async function runAnnouncement(db: PrismaClient, call: TelegramCall, options: {
  mode: "preview" | "send";
  expectedCount?: number;
  expectedDigest?: string;
  runId: string;
}, now = new Date()) {
  const users = await db.user.findMany({ where: { role: { in: ["ADMIN", "SUPERADMIN"] }, mergedIntoUserId: null }, select });
  const recipients = audience(users, now);
  const existing = await db.notificationLog.findMany({ where: { entityId: CAMPAIGN }, select: { id: true, status: true } });
  const claimed = new Set(existing.map(row => row.id));
  const pending = recipients.filter(recipient => !claimed.has(deliveryId(recipient.address)));
  const digest = hash(JSON.stringify(pending.map(({ userId, address }) => [userId, address])));
  const report = {
    campaign: CAMPAIGN, mode: options.mode, eligibleAccounts: users.length,
    reachable: recipients.length, pending: pending.length, digest,
    alreadySent: existing.filter(row => row.status === "SENT").length,
    unresolved: existing.filter(row => row.status !== "SENT").length,
    sent: 0, failed: 0, skipped: 0,
  };
  if (options.mode === "preview") return report;
  if (options.expectedCount !== pending.length || options.expectedDigest !== digest) throw new Error("AUDIENCE_CHANGED: run preview again");
  const bot = z.object({ id: z.number(), username: z.string() }).parse((await call("getMe", {})).result);
  if (bot.username.toLowerCase() !== "delovoypark_bot") throw new Error("UNEXPECTED_BOT");

  for (const recipient of pending) {
    const id = deliveryId(recipient.address);
    let acquired = false;
    try {
      acquired = await db.$transaction(async tx => {
        const current = await tx.user.findUnique({ where: { id: recipient.userId }, select });
        if (!current || recipientAddress(current, new Date()) !== recipient.address) return false;
        await tx.notificationLog.create({ data: {
          id, userId: current.id, channel: "TELEGRAM", eventType: "system.announcement",
          moduleSlug: "telephony", entityId: CAMPAIGN, recipient: recipient.address,
          message: MESSAGE, status: "PENDING",
        } });
        await tx.auditLog.create({ data: {
          userId: current.id, action: "system.announcement.claimed", entity: "NotificationLog", entityId: id,
          metadata: { campaign: CAMPAIGN, source: "owner-requested-ops", githubRunId: options.runId },
        } });
        return true;
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    }
    if (!acquired) { report.skipped++; continue; }

    // The durable claim is kept even on timeout/ambiguous response: no automatic resend.
    let status: "SENT" | "FAILED" = "FAILED";
    let errorCode = "DELIVERY_UNCONFIRMED";
    let messageId: number | null = null;
    try {
      const result = await call("sendMessage", {
        chat_id: recipient.address, text: MESSAGE,
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [[{ text: "Открыть Delovoy", web_app: { url: "https://delovoy-park.ru/webapp" } }]] },
      });
      const parsed = messageResult.safeParse(result.result);
      if (result.ok && parsed.success && String(parsed.data.chat.id) === recipient.address) {
        status = "SENT"; messageId = parsed.data.message_id;
      } else errorCode = result.error_code ? `TELEGRAM_${result.error_code}` : "DELIVERY_UNCONFIRMED";
    } catch { /* Keep the claim: a timeout does not prove non-delivery. */ }
    await db.$transaction([
      db.notificationLog.update({ where: { id }, data: { status, error: status === "SENT" ? null : errorCode, sentAt: status === "SENT" ? new Date() : null } }),
      db.auditLog.create({ data: {
        userId: recipient.userId, action: "system.announcement.result", entity: "NotificationLog", entityId: id,
        metadata: { campaign: CAMPAIGN, status, telegramMessageId: messageId, githubRunId: options.runId },
      } }),
    ]);
    if (status === "SENT") report.sent++; else report.failed++;
  }
  return report;
}

async function main() {
  const options = z.object({
    mode: z.enum(["preview", "send"]).default("preview"),
    expectedCount: z.coerce.number().int().nonnegative().optional(),
    expectedDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    runId: z.string().regex(/^\d+$/),
  }).parse({
    mode: process.env.ANNOUNCEMENT_MODE,
    expectedCount: process.env.ANNOUNCEMENT_COUNT || undefined,
    expectedDigest: process.env.ANNOUNCEMENT_DIGEST || undefined,
    runId: process.env.ANNOUNCEMENT_RUN_ID,
  });
  const db = new PrismaClient();
  const proxy = process.env.TELEGRAM_PROXY_URL ? new ProxyAgent(process.env.TELEGRAM_PROXY_URL) : undefined;
  const root = (process.env.TELEGRAM_API_ROOT || "https://api.telegram.org").replace(/\/+$/, "");
  const makeCall = (direct: boolean): TelegramCall => async (method, payload) => {
    if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error("BOT_NOT_CONFIGURED");
    const url = `${direct ? "https://api.telegram.org" : root}/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;
    const init = {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      signal: AbortSignal.timeout(method === "getMe" ? 8000 : 15000),
    };
    // Match the application's native fetch on the direct path; undici is only needed for CONNECT proxying.
    const response = !direct && proxy
      ? await proxyFetch(url, { ...init, dispatcher: proxy })
      : await fetch(url, init);
    return telegramResponse.parse(await response.json());
  };
  try {
    const transport = await chooseTransport(makeCall(false), makeCall(true), Boolean(proxy) || root !== "https://api.telegram.org");
    const result = await runAnnouncement(db, transport.call, options);
    console.log(JSON.stringify({ ...result, transport: transport.name, bot: transport.bot }));
    if (result.failed || result.unresolved) process.exitCode = 1;
  } finally {
    await db.$disconnect();
    await proxy?.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    const safeCodes = ["UNEXPECTED_BOT", "TELEGRAM_UNREACHABLE", "BOT_NOT_CONFIGURED", "AUDIENCE_CHANGED: run preview again"];
    console.error(error instanceof Error && safeCodes.includes(error.message) ? error.message : "Announcement failed; inspect delivery records before retrying.");
    process.exitCode = 1;
  });
}
