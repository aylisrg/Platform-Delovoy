import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "crypto";
import { validateInitData } from "../telegram-webapp";

const BOT_TOKEN = "12345:TEST_BOT_TOKEN";

/** Собирает initData с корректной подписью — тем же алгоритмом, что Telegram. */
function buildInitData(
  overrides: { authDate?: number; user?: object; hash?: string } = {}
): string {
  const authDate = overrides.authDate ?? Math.floor(Date.now() / 1000);
  const user =
    overrides.user ?? { id: 42, first_name: "Тест", username: "tester" };

  const params = new URLSearchParams();
  params.set("user", JSON.stringify(user));
  params.set("auth_date", String(authDate));
  params.set("query_id", "AAA");

  const entries: string[] = [];
  params.forEach((value, key) => entries.push(`${key}=${value}`));
  entries.sort();
  const checkString = entries.join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(BOT_TOKEN)
    .digest();
  const hash =
    overrides.hash ??
    crypto.createHmac("sha256", secretKey).update(checkString).digest("hex");

  params.set("hash", hash);
  return params.toString();
}

beforeEach(() => {
  vi.stubEnv("TELEGRAM_BOT_TOKEN", BOT_TOKEN);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("validateInitData", () => {
  it("парсит валидный initData", () => {
    const parsed = validateInitData(buildInitData());
    expect(parsed).not.toBeNull();
    expect(parsed?.user.id).toBe(42);
    expect(parsed?.user.first_name).toBe("Тест");
  });

  it("null при подделанном hash корректного формата (timing-safe путь)", () => {
    const parsed = validateInitData(buildInitData({ hash: "ab".repeat(32) }));
    expect(parsed).toBeNull();
  });

  it("null при hash неверной длины/не-hex — без исключения", () => {
    expect(validateInitData(buildInitData({ hash: "xyz" }))).toBeNull();
    expect(validateInitData(buildInitData({ hash: "abc123" }))).toBeNull();
  });

  it("null при auth_date старше часа", () => {
    const stale = Math.floor(Date.now() / 1000) - 3700;
    expect(validateInitData(buildInitData({ authDate: stale }))).toBeNull();
  });

  it("null без TELEGRAM_BOT_TOKEN", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    expect(validateInitData(buildInitData())).toBeNull();
  });
});
