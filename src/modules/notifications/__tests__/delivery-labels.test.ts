import { describe, it, expect } from "vitest";
import {
  FAILURE_CODE_LABELS,
  SKIP_REASON_LABELS,
  channelLabel,
  failureLabel,
  failureStatusLabel,
  skipReasonLabel,
  skipStatusLabel,
} from "../delivery-labels";

/** ADR 2026-10-25-team-access-notifications §5.2 «delivery-labels.ts», PRD AC-D2.3. */

describe("delivery labels (AC-D2.3)", () => {
  it("AC-D2.3: failure codes read as human Russian labels from the ADR list", () => {
    expect(FAILURE_CODE_LABELS).toEqual({
      BOT_BLOCKED: "Бот заблокирован",
      BOT_NOT_STARTED: "Бот не запущен",
      USER_DEACTIVATED: "Аккаунт Telegram удалён",
      NETWORK: "Канал недоступен",
      CHANNEL_UNAVAILABLE: "Канал недоступен",
      OTHER: "Канал недоступен",
      CHANNEL_EXPIRED: "Подписка браузера недействительна",
      CHANNEL_AUTH: "Подписка браузера недействительна",
      STALE: "Не отправлено вовремя",
    });
  });

  it("AC-D2.3: unknown or raw Telegram error text never reaches the UI", () => {
    expect(failureLabel("Forbidden: bot was blocked by the user")).toBe("Канал недоступен");
    expect(failureLabel(null)).toBe("Канал недоступен");
    expect(failureLabel("toString")).toBe("Канал недоступен");
  });

  it("AC-D2.2: status line «Ошибка: бот заблокирован»; legacy rows without a code → «Ошибка»", () => {
    expect(failureStatusLabel("BOT_BLOCKED")).toBe("Ошибка: бот заблокирован");
    expect(failureStatusLabel("BOT_NOT_STARTED")).toBe("Ошибка: бот не запущен");
    expect(failureStatusLabel("USER_DEACTIVATED")).toBe("Ошибка: аккаунт Telegram удалён");
    expect(failureStatusLabel(null)).toBe("Ошибка");
  });

  it("AC-D4.3: skip reasons — «нет канала», «не беспокоить», «отключено сотрудником», «дубль»", () => {
    expect(SKIP_REASON_LABELS).toEqual({
      NO_CHANNEL: "Нет канала",
      DND: "Не беспокоить",
      OPTED_OUT: "Отключено сотрудником",
      PREFERENCE_DISABLED: "Отключено сотрудником",
      DUPLICATE: "Дубль",
    });
    expect(skipStatusLabel("DND")).toBe("Пропущено: не беспокоить");
    expect(skipStatusLabel("WHATEVER")).toBe("Пропущено");
    expect(skipReasonLabel("WHATEVER")).toBe("Пропущено");
  });

  it("channel labels: IN_APP is the Mini App feed; unknown kinds pass through", () => {
    expect(channelLabel("IN_APP")).toBe("Лента Mini App");
    expect(channelLabel("PUSH")).toBe("Web Push");
    expect(channelLabel(null)).toBe("—");
    expect(channelLabel("NEWKIND")).toBe("NEWKIND");
  });
});
