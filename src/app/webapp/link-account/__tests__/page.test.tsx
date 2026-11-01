// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * Mini App «Привязка» — PRD 2026-10-25 US-E3/US-E4, ADR §7: only email,
 * generic text with the masked address, 503/502 → «Не удалось отправить код…»,
 * 409 → AC-E4.1.
 */

const mocks = vi.hoisted(() => {
  class ApiFetchError extends Error {
    constructor(readonly args: { code: string; message: string; status: number }) {
      super(args.message);
    }
    get code() {
      return this.args.code;
    }
    get status() {
      return this.args.status;
    }
  }
  return {
    ApiFetchError,
    apiFetch: vi.fn(),
    replace: vi.fn(),
    setUser: vi.fn(),
    setToken: vi.fn(),
    setNeedsLinking: vi.fn(),
    haptic: { impact: vi.fn(), notification: vi.fn(), selection: vi.fn() },
  };
});

vi.mock("@/components/webapp/TelegramProvider", () => ({
  ApiFetchError: mocks.ApiFetchError,
  useTelegram: () => ({
    apiFetch: mocks.apiFetch,
    setNeedsLinking: mocks.setNeedsLinking,
    setUser: mocks.setUser,
    setToken: mocks.setToken,
    haptic: mocks.haptic,
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));

import LinkAccountPage from "../page";

const GENERIC = "Если такой аккаунт есть, мы отправили код на его email.";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => cleanup());

async function submitEmail(value = "ivan@mail.ru") {
  fireEvent.change(screen.getByPlaceholderText("example@mail.ru"), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Получить код" }));
}

describe("LinkAccountPage", () => {
  it("AC-E3.6: offers email only (no phone option)", () => {
    render(<LinkAccountPage />);
    expect(screen.getByPlaceholderText("example@mail.ru")).toBeTruthy();
    expect(screen.queryByText(/телефон/i)).toBeNull();
  });

  it("AC-E3.1/AC-E3.3: shows the generic text with the masked address after the request", async () => {
    mocks.apiFetch.mockResolvedValueOnce({ sent: true, maskedValue: "iv***@mail.ru", expiresIn: 600, message: GENERIC });
    render(<LinkAccountPage />);
    await submitEmail();

    const note = await screen.findByTestId("otp-sent-note");
    expect(note.textContent).toContain("Если такой аккаунт есть, мы отправили код на его email");
    expect(note.textContent).toContain("iv***@mail.ru");
    expect(note.textContent).toContain("10 минут");
    expect(mocks.apiFetch).toHaveBeenCalledWith("/api/webapp/link/request", {
      method: "POST",
      body: JSON.stringify({ type: "email", value: "ivan@mail.ru" }),
    });
  });

  it.each([503, 502])("AC-E3.5: %i → «Не удалось отправить код…», not «код отправлен»", async (status) => {
    mocks.apiFetch.mockRejectedValueOnce(new mocks.ApiFetchError({ code: "OTP_SEND_FAILED", message: "x", status }));
    render(<LinkAccountPage />);
    await submitEmail();

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Не удалось отправить код. Попробуйте позже или обратитесь к администратору.",
    );
    expect(screen.queryByTestId("otp-sent-note")).toBeNull();
  });

  it("AC-E4.1: 409 on confirm → the merge-request text instead of an error", async () => {
    mocks.apiFetch
      .mockResolvedValueOnce({ sent: true, maskedValue: "iv***@mail.ru", expiresIn: 600, message: GENERIC })
      .mockRejectedValueOnce(
        new mocks.ApiFetchError({ code: "TELEGRAM_IN_USE_MERGE_REQUESTED", message: "Этот Telegram…", status: 409 }),
      );
    render(<LinkAccountPage />);
    await submitEmail();
    fireEvent.change(await screen.findByPlaceholderText("000000"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toBe(
      "Этот Telegram уже используется в другом аккаунте. Мы передали запрос администратору — он объединит аккаунты. Пока вы можете пользоваться текущим аккаунтом.",
    );
    expect(mocks.setToken).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Продолжить" }));
    expect(mocks.replace).toHaveBeenCalledWith("/webapp");
  });

  it("success: stores the new token of the target account and tells about the merge", async () => {
    mocks.apiFetch
      .mockResolvedValueOnce({ sent: true, maskedValue: "iv***@mail.ru", expiresIn: 600, message: GENERIC })
      .mockResolvedValueOnce({
        linked: true,
        merged: true,
        user: { id: "u-mgr", name: "Иван", role: "MANAGER", telegramId: "123" },
        token: "new.jwt.token",
      });
    render(<LinkAccountPage />);
    await submitEmail();
    fireEvent.change(await screen.findByPlaceholderText("000000"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить" }));

    expect(await screen.findByText("Аккаунт привязан!")).toBeTruthy();
    expect(screen.getByText(/объединён с вашим/)).toBeTruthy();
    expect(mocks.setToken).toHaveBeenCalledWith("new.jwt.token");
    expect(mocks.setUser).toHaveBeenCalledWith({ id: "u-mgr", name: "Иван", role: "MANAGER", telegramId: "123", image: null });
  });
});
