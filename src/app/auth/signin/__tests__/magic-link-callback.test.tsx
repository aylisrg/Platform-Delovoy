// @vitest-environment jsdom
//
// Хоп «форма → POST /api/auth/email/send» был единственным звеном цепочки
// возврата после логина, не покрытым ничем: qa-engineer (раунд 2 PR #916)
// показал, что мутация, убирающая `callbackUrl` из тела запроса, оставляет
// весь набор тестов зелёным. Ровно так BUG-2 и попал в прод-ветку.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { mockSearchParams } = vi.hoisted(() => ({
  mockSearchParams: { value: new URLSearchParams() },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams.value,
}));

vi.mock("next-auth/react", () => ({
  signIn: vi.fn().mockResolvedValue({ ok: false }),
}));

// Telegram-блок тянет поллинг и таймеры — для этого теста он не нужен.
vi.mock("@/components/auth/telegram-polling", () => ({
  TelegramSignInBlock: () => null,
}));

import SignInPage from "../page";

/** Тело последнего POST на /api/auth/email/send. */
function lastSendBody(): Record<string, unknown> | null {
  const call = vi
    .mocked(globalThis.fetch)
    .mock.calls.find(([url]) => String(url).includes("/api/auth/email/send"));
  if (!call) return null;
  return JSON.parse(String((call[1] as RequestInit).body));
}

async function openMagicLinkForm() {
  render(<SignInPage />);
  // Пока providers-status не ответил, страница рисует Telegram-ветку, где
  // кнопка лежит в свёрнутом <details>. Ждём переключения на email-ветку.
  await waitFor(() =>
    expect(screen.queryByText("Другие способы")).toBeNull(),
  );
  const emailBtn = await screen.findByRole("button", { name: "Войти по Email" });
  fireEvent.click(emailBtn);
  // findBy* ретраит — состояние React успевает примениться.
  const tab = await screen.findByRole("tab", { name: "Ссылка на почту" });
  fireEvent.click(tab);
  await screen.findByRole("button", { name: "Отправить ссылку" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSearchParams.value = new URLSearchParams();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      if (String(url).includes("providers-status")) {
        return {
          json: async () => ({
            success: true,
            data: { telegram: false, vk: false },
          }),
        } as Response;
      }
      return { json: async () => ({ success: true, data: { sent: true } }) } as Response;
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("страница входа — magic-link несёт адрес возврата", () => {
  it("кладёт callbackUrl из query в тело запроса письма", async () => {
    mockSearchParams.value = new URLSearchParams("callbackUrl=/for-team");

    await openMagicLinkForm();
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "u@e.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить ссылку" }));

    await waitFor(() => expect(lastSendBody()).not.toBeNull());
    expect(lastSendBody()).toMatchObject({
      email: "u@e.com",
      callbackUrl: "/for-team",
    });
  });

  it("без callbackUrl в query поле не отправляется", async () => {
    await openMagicLinkForm();
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "u@e.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить ссылку" }));

    await waitFor(() => expect(lastSendBody()).not.toBeNull());
    const body = lastSendBody()!;
    expect(body.email).toBe("u@e.com");
    expect(body.callbackUrl).toBeUndefined();
  });
});
