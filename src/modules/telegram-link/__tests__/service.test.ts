import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";

/**
 * Telegram self-link — ADR 2026-10-25-team-access-notifications §5.3/§Q9,
 * PRD US-E3 (OTP by email) and US-E4 (conflict → merge request).
 */

const h = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    redis: {
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      set: vi.fn(async (k: string, v: string, ...args: unknown[]) => {
        if (args[0] === "KEEPTTL" && args[1] === "XX" && !store.has(k)) return null;
        store.set(k, v);
        return "OK";
      }),
      del: vi.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
      incr: vi.fn(async (k: string) => {
        const next = Number(store.get(k) ?? 0) + 1;
        store.set(k, String(next));
        return next;
      }),
      expire: vi.fn(async () => 1),
    },
  };
});

vi.mock("@/lib/redis", () => ({ redis: h.redis, redisAvailable: true }));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    telegramLinkToken: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    userNotificationChannel: { upsert: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

vi.mock("@/lib/logger", () => ({ log: { warn: vi.fn(async () => undefined), error: vi.fn(async () => undefined) } }));

vi.mock("@/modules/notifications/channels/email", () => ({
  isTransactionalEmailConfigured: vi.fn(() => true),
  sendTransactionalEmail: vi.fn(async () => ({ success: true })),
}));

vi.mock("@/modules/clients/merge", () => ({ mergeAccounts: vi.fn() }));
vi.mock("@/modules/clients/merge-requests", () => ({ createMergeRequest: vi.fn(async () => "created") }));
vi.mock("@/modules/users/shell", () => ({ isDisposableTelegramShell: vi.fn() }));
vi.mock("../bot-contact", () => ({ recordBotContact: vi.fn(async () => undefined) }));

import { prisma } from "@/lib/db";
import { log } from "@/lib/logger";
import { isTransactionalEmailConfigured, sendTransactionalEmail } from "@/modules/notifications/channels/email";
import { mergeAccounts } from "@/modules/clients/merge";
import { createMergeRequest } from "@/modules/clients/merge-requests";
import { isDisposableTelegramShell } from "@/modules/users/shell";
import { DomainError } from "@/modules/users/errors";
import { recordBotContact } from "../bot-contact";
import {
  requestLink,
  confirmLink,
  skipLink,
  generateDeepLink,
  processDeepLink,
  previewDeepLink,
  hasSkippedLinking,
  resetLinkServiceState,
  LinkError,
  LINK_MESSAGES,
} from "../service";

const TG = "123456789";
const GENERIC = "Если такой аккаунт есть, мы отправили код на его email.";
const CONFLICT_TEXT =
  "Этот Telegram уже используется в другом аккаунте. Мы передали запрос администратору — он объединит аккаунты. Пока вы можете пользоваться текущим аккаунтом";

const sha256 = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

type ConsoleSpy = { mock: { calls: unknown[][] }; mockRestore: () => void };
let consoleSpies: ConsoleSpy[] = [];

function consoleOutput(): string {
  return consoleSpies.flatMap((s) => s.mock.calls.map((args) => JSON.stringify(args))).join("\n");
}

const target = { id: "u-mgr", role: "MANAGER", email: "Ivan@Mail.ru", telegramId: null };

function sentCode(): string {
  const call = vi.mocked(sendTransactionalEmail).mock.calls.at(-1);
  const text = (call?.[0] as { text?: string } | undefined)?.text ?? "";
  const match = /(\d{6})/.exec(text);
  if (!match) throw new Error("no code in the email");
  return match[1];
}

async function requestCode(telegramId = TG, email = "ivan@mail.ru") {
  vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(target as never);
  await requestLink(telegramId, { type: "email", value: email });
  return sentCode();
}

beforeEach(() => {
  vi.clearAllMocks();
  h.store.clear();
  resetLinkServiceState();
  vi.mocked(isTransactionalEmailConfigured).mockReturnValue(true);
  vi.mocked(sendTransactionalEmail).mockResolvedValue({ success: true });
  vi.mocked(createMergeRequest).mockResolvedValue("created");
  consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => undefined),
  );
});

afterEach(() => {
  for (const spy of consoleSpies) spy.mockRestore();
});

describe("requestLink (US-E3)", () => {
  it("AC-E3.1: emails a 6-digit code to the account address (sensitive), answers generically with the masked typed address", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(target as never);
    const randomInt = vi.spyOn(crypto, "randomInt");

    const result = await requestLink(TG, { type: "email", value: "  IVAN@mail.ru " });

    expect(result).toEqual({ sent: true, maskedValue: "iv***@mail.ru", expiresIn: 600, message: GENERIC });
    expect(randomInt).toHaveBeenCalledWith(100000, 1000000);
    const email = vi.mocked(sendTransactionalEmail).mock.calls[0][0] as { to: string; sensitive?: boolean; text: string; html: string };
    expect(email.to).toBe("Ivan@Mail.ru");
    expect(email.sensitive).toBe(true);
    const code = sentCode();
    expect(email.text).toContain("действует 10 минут");
    expect(email.text).toContain("Если это были не вы — проигнорируйте письмо");
    expect(email.html).toContain(code);

    // Redis keeps only sha256(code + telegramId), never the code itself.
    const stored = h.store.get(`tg-link:otp:${TG}`)!;
    expect(stored).not.toContain(code);
    expect(JSON.parse(stored)).toMatchObject({ targetUserId: "u-mgr", codeHash: sha256(code + TG), attempts: 0 });
    expect(h.redis.set).toHaveBeenCalledWith(`tg-link:otp:${TG}`, stored, "EX", 600);
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ mergedIntoUserId: null }) }),
    );
    randomInt.mockRestore();
  });

  it("AC-E3.2: the code never reaches console.* — request, wrong attempt, confirm", async () => {
    const code = await requestCode();
    await expect(confirmLink(TG, code === "111111" ? "222222" : "111111")).rejects.toMatchObject({ code: "INVALID_CODE" });
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({ ...target, mergedIntoUserId: null } as never) // target
      .mockResolvedValueOnce(null); // no TG account
    vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValueOnce({ id: "u-mgr", name: "Иван", role: "MANAGER", telegramId: TG, sessionVersion: 0 } as never);
    await confirmLink(TG, code);
    expect(consoleOutput()).not.toContain(code);
    expect(JSON.stringify(vi.mocked(log.error).mock.calls)).not.toContain(code);
  });

  it("AC-E3.3: no account → the same answer, nothing sent, no code stored", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null);
    const result = await requestLink(TG, { type: "email", value: "nobody@mail.ru" });
    expect(result).toEqual({ sent: true, maskedValue: "no***@mail.ru", expiresIn: 600, message: GENERIC });
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    expect(h.store.has(`tg-link:otp:${TG}`)).toBe(false);
  });

  it("AC-E3.3: the account already owns this Telegram → the same answer, no code", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({ ...target, telegramId: TG } as never);
    expect((await requestLink(TG, { type: "email", value: "ivan@mail.ru" })).message).toBe(GENERIC);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("AC-E3.7 / ADR §Q9: SUPERADMIN account → info email without a code, the same answer", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({ ...target, role: "SUPERADMIN" } as never);
    const result = await requestLink(TG, { type: "email", value: "ivan@mail.ru" });
    expect(result.message).toBe(GENERIC);
    const email = vi.mocked(sendTransactionalEmail).mock.calls[0][0] as { text: string; sensitive?: boolean };
    expect(email.sensitive).toBe(true);
    expect(email.text).toContain("Привязку Telegram к этому аккаунту выполняет суперадмин");
    expect(email.text).not.toMatch(/\d{6}/);
    expect(h.store.has(`tg-link:otp:${TG}`)).toBe(false);
  });

  it("AC-E3.5: SMTP not configured → 503 for everyone, before any lookup; WARNING at most once a minute", async () => {
    vi.mocked(isTransactionalEmailConfigured).mockReturnValue(false);
    for (let i = 0; i < 2; i++) {
      await expect(requestLink(TG, { type: "email", value: "ivan@mail.ru" })).rejects.toMatchObject({
        code: "OTP_DELIVERY_UNAVAILABLE",
        status: 503,
        message: LINK_MESSAGES.OTP_UNAVAILABLE,
      });
    }
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it("AC-E3.5: the email failed → 502 OTP_SEND_FAILED, the code is dropped, ERROR with emailHash only", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(target as never);
    vi.mocked(sendTransactionalEmail).mockResolvedValueOnce({ success: false, error: "550 mailbox unavailable" });

    await expect(requestLink(TG, { type: "email", value: "ivan@mail.ru" })).rejects.toMatchObject({
      code: "OTP_SEND_FAILED",
      status: 502,
      message: "Не удалось отправить код. Попробуйте позже или обратитесь к администратору",
    });
    expect(h.store.has(`tg-link:otp:${TG}`)).toBe(false);
    expect(log.error).toHaveBeenCalledWith("auth", "OTP email send failed", { emailHash: sha256("ivan@mail.ru") });
    expect(JSON.stringify(vi.mocked(log.error).mock.calls)).not.toContain("ivan@mail.ru");
  });

  it("AC-E3.6: phone → 422 PHONE_LINK_UNAVAILABLE; malformed email → 422", async () => {
    await expect(requestLink(TG, { type: "phone", value: "+79001234567" })).rejects.toMatchObject({
      code: "PHONE_LINK_UNAVAILABLE",
      status: 422,
    });
    await expect(requestLink(TG, { type: "email", value: "not-an-email" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
    });
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("AC-E3.4: at most 3 code requests per email per hour (counted for any Telegram)", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    for (const tg of ["1001", "1002", "1003"]) {
      await requestLink(tg, { type: "email", value: "ivan@mail.ru" });
    }
    await expect(requestLink("1004", { type: "email", value: "ivan@mail.ru" })).rejects.toMatchObject({
      code: "LINK_BLOCKED",
      status: 429,
    });
    expect(h.redis.expire).toHaveBeenCalledWith(`tg-link:otp-email:${sha256("ivan@mail.ru")}`, 3600);
  });

  it("AC-E3.4: at most 5 code requests per Telegram per hour", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    for (let i = 0; i < 5; i++) {
      await requestLink(TG, { type: "email", value: `user${i}@mail.ru` });
    }
    await expect(requestLink(TG, { type: "email", value: "user9@mail.ru" })).rejects.toMatchObject({
      code: "LINK_BLOCKED",
      status: 429,
    });
  });

  it("a blocked Telegram (3 wrong codes) can't request", async () => {
    h.store.set(`tg-link:block:${TG}`, "1");
    await expect(requestLink(TG, { type: "email", value: "ivan@mail.ru" })).rejects.toMatchObject({ code: "LINK_BLOCKED", status: 429 });
  });

  it("AC-E3.4: an address with 5 wrong codes in an hour gets no codes — silently, same answer", async () => {
    h.store.set(`tg-link:otp-fail-email:${sha256("ivan@mail.ru")}`, "5");
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(target as never);
    expect((await requestLink(TG, { type: "email", value: "ivan@mail.ru" })).message).toBe(GENERIC);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });
});

describe("confirmLink (US-E3 / US-E4)", () => {
  function linkedUser(overrides: Record<string, unknown> = {}) {
    return { id: "u-mgr", name: "Иван", role: "MANAGER", telegramId: TG, sessionVersion: 3, ...overrides };
  }

  it("AC-E3.4: wrong code → 400, attempts kept with the original TTL; the address failure counter grows", async () => {
    const code = await requestCode();
    const wrong = code === "000000" ? "999999" : "000000";
    await expect(confirmLink(TG, wrong)).rejects.toMatchObject({ code: "INVALID_CODE", status: 400 });
    expect(JSON.parse(h.store.get(`tg-link:otp:${TG}`)!).attempts).toBe(1);
    expect(h.redis.set).toHaveBeenCalledWith(`tg-link:otp:${TG}`, expect.any(String), "KEEPTTL", "XX");
    expect(h.store.get(`tg-link:otp-fail-email:${sha256("ivan@mail.ru")}`)).toBe("1");
  });

  it("AC-E3.4: 3 wrong codes → 429 and a 15-minute block; the code is gone", async () => {
    const code = await requestCode();
    const wrong = code === "000000" ? "999999" : "000000";
    await expect(confirmLink(TG, wrong)).rejects.toMatchObject({ code: "INVALID_CODE" });
    await expect(confirmLink(TG, wrong)).rejects.toMatchObject({ code: "INVALID_CODE" });
    await expect(confirmLink(TG, wrong)).rejects.toMatchObject({ code: "LINK_BLOCKED", status: 429 });
    expect(h.redis.set).toHaveBeenCalledWith(`tg-link:block:${TG}`, "1", "EX", 900);
    expect(h.store.has(`tg-link:otp:${TG}`)).toBe(false);
    await expect(confirmLink(TG, code)).rejects.toMatchObject({ code: "LINK_BLOCKED" });
  });

  it("no code requested / expired → 410", async () => {
    await expect(confirmLink(TG, "123456")).rejects.toMatchObject({ code: "CODE_EXPIRED", status: 410 });
  });

  it("AC-E3.8: free Telegram → linked, verified TELEGRAM channel (priority 10), bot contact, audit; token claims for the target", async () => {
    const code = await requestCode();
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({ ...target, mergedIntoUserId: null } as never)
      .mockResolvedValueOnce(null);
    vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValueOnce(linkedUser() as never);

    const result = await confirmLink(TG, code);

    expect(result).toEqual({
      linked: true,
      merged: false,
      user: { id: "u-mgr", name: "Иван", role: "MANAGER", telegramId: TG, sessionVersion: 3 },
      token: "",
    });
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: "u-mgr" }, data: { telegramId: TG } });
    expect(prisma.userNotificationChannel.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_kind_address: { userId: "u-mgr", kind: "TELEGRAM", address: TG } },
        create: expect.objectContaining({ priority: 10, isActive: true, verifiedAt: expect.any(Date) }),
      }),
    );
    expect(recordBotContact).toHaveBeenCalledWith(TG);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "u-mgr",
        action: "telegram.link.otp",
        metadata: { targetRole: "MANAGER", merged: false },
      }),
    });
  });

  it("AC-E3.4: the code is one-time", async () => {
    const code = await requestCode();
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({ ...target, mergedIntoUserId: null } as never)
      .mockResolvedValueOnce(null);
    vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValueOnce(linkedUser() as never);
    await confirmLink(TG, code);
    await expect(confirmLink(TG, code)).rejects.toMatchObject({ code: "CODE_EXPIRED", status: 410 });
  });

  it("ADR §Q9: the Mini App's own account is a disposable shell → mergeAccounts(self_link) into the email account", async () => {
    const code = await requestCode();
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({ ...target, mergedIntoUserId: null } as never)
      .mockResolvedValueOnce({ id: "u-tg" } as never);
    vi.mocked(isDisposableTelegramShell).mockResolvedValueOnce(true);
    vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValueOnce(linkedUser() as never);

    const result = await confirmLink(TG, code);

    expect(mergeAccounts).toHaveBeenCalledWith({ mode: "self_link", primaryId: "u-mgr", secondaryId: "u-tg", actorId: "u-mgr" });
    expect(result.merged).toBe(true);
    expect(createMergeRequest).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "telegram.link.otp", metadata: { targetRole: "MANAGER", merged: true } }),
    });
  });

  it("AC-E4.1/AC-E4.2: the Telegram account has history → merge request + 409, nothing linked", async () => {
    const code = await requestCode();
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({ ...target, mergedIntoUserId: null } as never)
      .mockResolvedValueOnce({ id: "u-tg" } as never);
    vi.mocked(isDisposableTelegramShell).mockResolvedValueOnce(false);

    const err = await confirmLink(TG, code).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(LinkError);
    expect(err).toMatchObject({ code: "TELEGRAM_IN_USE_MERGE_REQUESTED", status: 409, message: CONFLICT_TEXT });
    expect(createMergeRequest).toHaveBeenCalledWith({ userAId: "u-mgr", userBId: "u-tg", reason: "telegram_conflict", telegramId: TG });
    expect(mergeAccounts).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.userNotificationChannel.upsert).not.toHaveBeenCalled();
  });

  it("AC-E4.1: the email account already has another Telegram → merge request + 409 (no shell check)", async () => {
    const code = await requestCode();
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({ ...target, telegramId: "999", mergedIntoUserId: null } as never)
      .mockResolvedValueOnce({ id: "u-tg" } as never);

    await expect(confirmLink(TG, code)).rejects.toMatchObject({ code: "TELEGRAM_IN_USE_MERGE_REQUESTED" });
    expect(isDisposableTelegramShell).not.toHaveBeenCalled();
    expect(createMergeRequest).toHaveBeenCalledTimes(1);
  });

  it("a guard fired inside the self_link merge → falls back to the merge request + 409", async () => {
    const code = await requestCode();
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({ ...target, mergedIntoUserId: null } as never)
      .mockResolvedValueOnce({ id: "u-tg" } as never);
    vi.mocked(isDisposableTelegramShell).mockResolvedValueOnce(true);
    vi.mocked(mergeAccounts).mockRejectedValueOnce(new DomainError("ALREADY_MERGED", "x", 409));

    await expect(confirmLink(TG, code)).rejects.toMatchObject({ code: "TELEGRAM_IN_USE_MERGE_REQUESTED" });
    expect(createMergeRequest).toHaveBeenCalledTimes(1);
  });

  it("the target is (now) a SUPERADMIN or merged → INVALID_CODE", async () => {
    const code = await requestCode();
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ ...target, role: "SUPERADMIN", mergedIntoUserId: null } as never);
    await expect(confirmLink(TG, code)).rejects.toMatchObject({ code: "INVALID_CODE", status: 400 });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("the Telegram already belongs to the target → success without changes", async () => {
    const code = await requestCode();
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({ ...target, telegramId: TG, mergedIntoUserId: null } as never)
      .mockResolvedValueOnce({ id: "u-mgr" } as never);
    vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValueOnce(linkedUser() as never);
    const result = await confirmLink(TG, code);
    expect(result.merged).toBe(false);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(mergeAccounts).not.toHaveBeenCalled();
  });
});

describe("previewDeepLink — the bot asks before linking", () => {
  const token = "b".repeat(48);

  it("says whose link it is (masked email) and consumes / links nothing", async () => {
    h.store.set(`tg-link:token:${token}`, "u-web");
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u-web", name: "Иван", email: "ivan@mail.ru", role: "MANAGER", telegramId: null, mergedIntoUserId: null,
    } as never);

    expect(await previewDeepLink(token)).toEqual({ userName: "Иван", emailMasked: "iv***@mail.ru" });
    expect(h.store.has(`tg-link:token:${token}`)).toBe(true);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.telegramLinkToken.update).not.toHaveBeenCalled();
    expect(mergeAccounts).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("an unknown token → 400 INVALID_TOKEN, same as the real call", async () => {
    vi.mocked(prisma.telegramLinkToken.findUnique).mockResolvedValueOnce(null);
    await expect(previewDeepLink(token)).rejects.toMatchObject({ code: "INVALID_TOKEN", status: 400 });
  });
});

describe("processDeepLink (web session → bot, ADR §Q9)", () => {
  const token = "a".repeat(48);
  const webUser = { id: "u-web", name: "Иван", role: "SUPERADMIN", telegramId: null, mergedIntoUserId: null };

  it("links a free Telegram for any role (incl. SUPERADMIN): channel, bot contact, audit, token used", async () => {
    h.store.set(`tg-link:token:${token}`, "u-web");
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(webUser as never)
      .mockResolvedValueOnce(null);
    vi.mocked(prisma.telegramLinkToken.update).mockResolvedValue({} as never);

    const result = await processDeepLink({ token, telegramId: TG });

    expect(result).toEqual({ linked: true, userName: "Иван", merged: false });
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: "u-web" }, data: { telegramId: TG } });
    expect(prisma.telegramLinkToken.update).toHaveBeenCalledWith({ where: { token }, data: { usedAt: expect.any(Date) } });
    expect(h.store.has(`tg-link:token:${token}`)).toBe(false);
    expect(prisma.userNotificationChannel.upsert).toHaveBeenCalled();
    expect(recordBotContact).toHaveBeenCalledWith(TG);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "telegram.link.deeplink", metadata: { targetRole: "SUPERADMIN", merged: false } }),
    });
  });

  it("the Telegram's own account is a shell → self_link merge into the web account", async () => {
    h.store.set(`tg-link:token:${token}`, "u-web");
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(webUser as never)
      .mockResolvedValueOnce({ id: "u-tg" } as never);
    vi.mocked(isDisposableTelegramShell).mockResolvedValueOnce(true);
    vi.mocked(prisma.telegramLinkToken.update).mockResolvedValue({} as never);

    const result = await processDeepLink({ token, telegramId: TG });
    expect(result.merged).toBe(true);
    expect(mergeAccounts).toHaveBeenCalledWith({ mode: "self_link", primaryId: "u-web", secondaryId: "u-tg", actorId: "u-web" });
  });

  it("AC-E4.1: the Telegram account has history → merge request + 409", async () => {
    h.store.set(`tg-link:token:${token}`, "u-web");
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(webUser as never)
      .mockResolvedValueOnce({ id: "u-tg" } as never);
    vi.mocked(isDisposableTelegramShell).mockResolvedValueOnce(false);

    await expect(processDeepLink({ token, telegramId: TG })).rejects.toMatchObject({
      code: "TELEGRAM_IN_USE_MERGE_REQUESTED",
      status: 409,
      message: CONFLICT_TEXT,
    });
    expect(createMergeRequest).toHaveBeenCalledWith({ userAId: "u-web", userBId: "u-tg", reason: "telegram_conflict", telegramId: TG });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("unknown / used / expired token → 400 INVALID_TOKEN; a merged web account too", async () => {
    vi.mocked(prisma.telegramLinkToken.findUnique).mockResolvedValueOnce(null);
    await expect(processDeepLink({ token, telegramId: TG })).rejects.toMatchObject({ code: "INVALID_TOKEN", status: 400 });

    vi.mocked(prisma.telegramLinkToken.findUnique).mockResolvedValueOnce({
      userId: "u-web",
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ ...webUser, mergedIntoUserId: "u-other" } as never);
    await expect(processDeepLink({ token, telegramId: TG })).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });
});

describe("skip / generateDeepLink", () => {
  it("skipLink sets the 30-day flag; hasSkippedLinking reads it", async () => {
    await skipLink(TG);
    expect(h.redis.set).toHaveBeenCalledWith(`tg-link:skipped:${TG}`, "1", "EX", 30 * 24 * 3600);
    expect(await hasSkippedLinking(TG)).toBe(true);
    expect(await hasSkippedLinking("other")).toBe(false);
  });

  it("generates a deep link for a user without Telegram", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ telegramId: null } as never);
    vi.mocked(prisma.telegramLinkToken.create).mockResolvedValue({} as never);
    const result = await generateDeepLink("user-1");
    expect(result.deepLink).toMatch(/^https:\/\/t\.me\/.+\?start=link_[0-9a-f]{48}$/);
    expect(result.expiresIn).toBe(900);
  });

  it("refuses when the user already has Telegram", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ telegramId: "tg-existing" } as never);
    await expect(generateDeepLink("user-1")).rejects.toMatchObject({ code: "TELEGRAM_ALREADY_LINKED", status: 409 });
  });
});

describe("LinkError", () => {
  it("has correct properties", () => {
    const err = new LinkError("SOME_CODE", "some message", 400);
    expect(err).toMatchObject({ code: "SOME_CODE", message: "some message", status: 400 });
    expect(err instanceof Error).toBe(true);
  });
});
