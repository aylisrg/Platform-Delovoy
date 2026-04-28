/**
 * Telegram bot deep-link auth handler.
 *
 * Wave 2 §1: when a user clicks the link minted by
 * /api/auth/telegram/start, they land here as `/start auth_<token>`.
 *
 * Flow
 *  1. We validate the token in Redis (must be PENDING) and stash a
 *     mapping `auth:tg:awaiting:<tgUserId>` → token so the contact
 *     reply can find its way back even after a bot restart.
 *  2. We send a one-tap "📞 Поделиться номером" reply keyboard
 *     (request_contact: true). Telegram only fires this for the user
 *     who pressed it, and only with their own real phone number.
 *  3. On the contact event:
 *     - normalize phone (RU mobile only),
 *     - find/create the User in a single Prisma transaction,
 *     - upsert UserNotificationChannel(TELEGRAM, chatId, isVerified=true,
 *       priority=1),
 *     - try auto-merge if there's an existing user matching by phone but
 *       NOT yet bound to this Telegram id,
 *     - flip the Redis token to CONFIRMED with the resolved userId,
 *     - reply with success and tear the awaiting key down.
 *
 * Security
 *  - We reject contact messages where contact.user_id !== ctx.from.id —
 *    Telegram allows forwarding someone else's contact, that path must
 *    not yield a sign-in.
 *  - chatId is logged with maskChatId() in AuditLog metadata; never raw.
 */
import type { Bot, Context } from "grammy";
import { Keyboard } from "grammy";
import { prisma } from "@/lib/db";
import { redis, redisAvailable } from "@/lib/redis";
import { logAuthEvent, maskChatId, hashIp } from "@/lib/audit";
import { normalizePhone } from "@/lib/phone";
import {
  TOKEN_PREFIX,
  confirmToken,
  readTokenEntry,
} from "@/modules/auth/telegram-deep-link";
import { autoMergeOnLogin } from "@/modules/auth/auto-merge";

const AWAITING_PREFIX = "auth:tg:awaiting:";
const AWAITING_TTL_SEC = 5 * 60;

export const AUTH_DEEPLINK_PREFIX = "auth_";

/**
 * Returns true when the deep link param is an `auth_<token>` link and
 * was handled (success or failure). Returns false for unrelated links
 * so the caller can dispatch to other handlers.
 */
export async function handleAuthDeepLink(
  ctx: Context,
  deepLinkParam: string
): Promise<boolean> {
  if (!deepLinkParam.startsWith(AUTH_DEEPLINK_PREFIX)) return false;

  const token = deepLinkParam.slice(AUTH_DEEPLINK_PREFIX.length);
  if (!token || token.length < 10 || token.length > 64) {
    await ctx.reply(
      "Ссылка для входа недействительна. Вернись на сайт и нажми «Войти через Telegram» ещё раз."
    );
    return true;
  }

  const entry = await readTokenEntry(token);
  if (!entry || entry.status !== "PENDING") {
    await ctx.reply(
      "Ссылка для входа устарела или уже использована. Вернись на сайт и попробуй снова."
    );
    return true;
  }

  const tgUserId = ctx.from?.id;
  if (!tgUserId) {
    await ctx.reply("Не удалось определить твой Telegram. Попробуй ещё раз.");
    return true;
  }

  // Stash awaiting → token so we can still resolve after bot restart.
  if (redisAvailable) {
    await redis.set(
      AWAITING_PREFIX + String(tgUserId),
      token,
      "EX",
      AWAITING_TTL_SEC
    );
  }

  await ctx.reply(
    "Чтобы войти на сайт, поделись номером телефона. Кнопка ниже отправит только его — никаких других данных.",
    {
      reply_markup: new Keyboard()
        .requestContact("📞 Поделиться номером")
        .resized()
        .oneTime(),
    }
  );

  return true;
}

/**
 * Contact event handler. Looks up the awaiting token for the sender,
 * runs the sign-in transaction, then flips the Redis token to
 * CONFIRMED so the website's poll picks up the result.
 */
export async function handleAuthContact(ctx: Context): Promise<boolean> {
  const contact = ctx.message?.contact;
  if (!contact) return false;

  const tgUserId = ctx.from?.id;
  if (!tgUserId) return false;

  // Security: reject contacts shared on someone else's behalf.
  if (contact.user_id !== tgUserId) {
    await ctx.reply(
      "Можно делиться только своим контактом. Попробуй ещё раз — нажми кнопку под сообщением.",
      { reply_markup: { remove_keyboard: true } }
    );
    return true;
  }

  if (!redisAvailable) {
    await ctx.reply(
      "Сервис временно недоступен. Попробуй через минуту.",
      { reply_markup: { remove_keyboard: true } }
    );
    return true;
  }

  const awaitingKey = AWAITING_PREFIX + String(tgUserId);
  const token = await redis.get(awaitingKey);
  if (!token) {
    await ctx.reply(
      "Не вижу активного запроса на вход. Вернись на сайт и нажми «Войти через Telegram» ещё раз.",
      { reply_markup: { remove_keyboard: true } }
    );
    return true;
  }

  const entry = await readTokenEntry(token);
  if (!entry || entry.status !== "PENDING") {
    await redis.del(awaitingKey);
    await ctx.reply(
      "Ссылка устарела. Вернись на сайт и нажми «Войти через Telegram» ещё раз.",
      { reply_markup: { remove_keyboard: true } }
    );
    return true;
  }

  const phoneNormalized = normalizePhone(contact.phone_number);
  const telegramId = String(tgUserId);
  const chatId = String(ctx.chat?.id ?? tgUserId);
  const firstName = (ctx.from?.first_name ?? "").trim();
  const lastName = (ctx.from?.last_name ?? "").trim();
  const username = ctx.from?.username ?? null;
  const fullName = [firstName, lastName].filter(Boolean).join(" ") || username || null;

  // ---- atomic transaction: create or fetch the surviving User and bind
  // its Telegram channel + Account.
  let primaryUserId: string;
  let isNewUser: boolean;
  let phoneMatchedExistingUser: { id: string; role: string } | null = null;
  let multipleCandidates: Array<{ id: string; role: string; matchedBy: "phone" | "telegramId" }> = [];

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Look up by both keys in parallel so we can detect splits.
      const [byTelegram, byPhone] = await Promise.all([
        tx.user.findFirst({
          where: { telegramId, mergedIntoUserId: null },
          select: { id: true, role: true, name: true },
        }),
        phoneNormalized
          ? tx.user.findFirst({
              where: { phoneNormalized, mergedIntoUserId: null },
              select: { id: true, role: true, name: true },
            })
          : Promise.resolve(null),
      ]);

      const candidates: Array<{ id: string; role: string; matchedBy: "phone" | "telegramId" }> = [];

      let survivor: { id: string; role: string } | null = null;
      let createdNew = false;

      if (byTelegram) {
        survivor = { id: byTelegram.id, role: byTelegram.role };
        // If phone matches a different user, it's a candidate for auto-merge.
        if (byPhone && byPhone.id !== byTelegram.id) {
          candidates.push({ id: byPhone.id, role: byPhone.role, matchedBy: "phone" });
        }
      } else if (byPhone) {
        // No Telegram-bound user yet — we enrich the phone-matched user
        // with telegramId/chatId on this login.
        survivor = { id: byPhone.id, role: byPhone.role };
      }

      if (!survivor) {
        // Brand-new account.
        const created = await tx.user.create({
          data: {
            telegramId,
            phone: phoneNormalized,
            phoneNormalized: phoneNormalized,
            name: fullName,
            source: "telegram_bot",
            lastSeenAt: new Date(),
          },
          select: { id: true, role: true },
        });
        survivor = { id: created.id, role: created.role };
        createdNew = true;
      } else {
        // Enrich survivor with anything they're missing — null-fill only.
        const existing = await tx.user.findUnique({
          where: { id: survivor.id },
          select: { telegramId: true, phone: true, phoneNormalized: true, name: true },
        });
        const updates: Record<string, unknown> = { lastSeenAt: new Date() };
        if (!existing?.telegramId) updates.telegramId = telegramId;
        if (!existing?.phone && phoneNormalized) updates.phone = phoneNormalized;
        if (!existing?.phoneNormalized && phoneNormalized) {
          updates.phoneNormalized = phoneNormalized;
        }
        if (!existing?.name && fullName) updates.name = fullName;
        await tx.user.update({ where: { id: survivor.id }, data: updates });
      }

      // Upsert UserNotificationChannel(TELEGRAM, chatId)
      await tx.userNotificationChannel.upsert({
        where: {
          userId_kind_address: {
            userId: survivor.id,
            kind: "TELEGRAM",
            address: chatId,
          },
        },
        create: {
          userId: survivor.id,
          kind: "TELEGRAM",
          address: chatId,
          priority: 1,
          isActive: true,
          verifiedAt: new Date(),
        },
        update: {
          isActive: true,
          verifiedAt: new Date(),
        },
      });

      // Upsert Account(provider=telegram-token) — for parity with
      // OAuth providers and to make Wave-3 listAccounts simple.
      await tx.account.upsert({
        where: {
          provider_providerAccountId: {
            provider: "telegram-token",
            providerAccountId: telegramId,
          },
        },
        create: {
          userId: survivor.id,
          type: "oauth",
          provider: "telegram-token",
          providerAccountId: telegramId,
        },
        update: {
          userId: survivor.id,
        },
      });

      return {
        userId: survivor.id,
        isNewUser: createdNew,
        candidates,
      };
    });

    primaryUserId = result.userId;
    isNewUser = result.isNewUser;
    multipleCandidates = result.candidates;
    if (multipleCandidates.length === 1) {
      phoneMatchedExistingUser = {
        id: multipleCandidates[0].id,
        role: multipleCandidates[0].role,
      };
    }
  } catch (err) {
    console.error("[Auth/bot] sign-in transaction failed", err);
    await ctx.reply(
      "Что-то пошло не так. Попробуй ещё раз через минуту.",
      { reply_markup: { remove_keyboard: true } }
    );
    return true;
  }

  // Auto-merge step (outside the bind tx — uses its own transaction).
  if (phoneMatchedExistingUser) {
    await autoMergeOnLogin({
      primaryUserId,
      candidates: [
        {
          id: phoneMatchedExistingUser.id,
          role: phoneMatchedExistingUser.role,
          matchedBy: "phone",
        },
      ],
      provider: "telegram-token",
    });
  }

  // Flip Redis to CONFIRMED for the website poll.
  await confirmToken(token, primaryUserId, isNewUser);
  await redis.del(awaitingKey);

  // Audit: signin.success with masked chatId.
  // IP isn't available inside the bot context (long-polling), but the
  // hashIp helper accepts undefined gracefully.
  await logAuthEvent("auth.signin.success", primaryUserId, {
    provider: "telegram-token",
    method: "deeplink",
    isNewUser,
    chatIdMasked: maskChatId(chatId),
    ipHash: hashIp(undefined),
  });

  await ctx.reply(
    "Вход подтверждён. Возвращайся на сайт — страница обновится сама. И сюда тоже буду писать брони и заказы.",
    { reply_markup: { remove_keyboard: true } }
  );

  return true;
}

/**
 * Wire handlers into the bot. Idempotent — the on("message:contact")
 * handler is shared but we do an early-return for non-auth contacts so
 * other features can keep using request_contact.
 */
export function registerAuthDeepLinkHandlers(bot: Bot): void {
  bot.on("message:contact", async (ctx, next) => {
    const handled = await handleAuthContact(ctx);
    if (!handled) await next();
  });
}

// Exposed for tests
export { TOKEN_PREFIX, AWAITING_PREFIX };
