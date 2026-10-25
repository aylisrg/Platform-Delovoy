// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(), showBackButton: vi.fn(), onBackButtonClick: vi.fn(),
  haptic: { selection: vi.fn(), notification: vi.fn() },
}));
vi.mock("@/components/webapp/TelegramProvider", () => ({
  useTelegram: () => ({ ready: true, ...mocks }),
  ApiFetchError: class extends Error {},
}));

import NotificationCenterPage from "../page";

const data = {
  role: "SUPERADMIN",
  channel: { kind: "TELEGRAM", status: "inactive", provisionedNow: false },
  categories: [{ key: "telephony", label: "Звонки", description: "Ежедневные итоги Novofon", icon: "bell", delivery: "in-app", events: [{ eventType: "telephony.daily_summary", label: "Итоги звонков за день", description: "Всего, принято и пропущено", enabled: true, source: "default", caption: "В ленте Mini App", blockers: [] }] }],
  protected: [],
  transparencyNote: "Руководитель видит, доставлены ли вам уведомления и открывали ли вы их",
  emptyState: null,
  hint: null,
};

beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);

describe("In-app notification preferences", () => {
  it("keeps a default-enabled daily summary independent of the inactive Telegram channel", async () => {
    mocks.apiFetch.mockResolvedValue(data);
    render(<NotificationCenterPage />);
    const toggle = await screen.findByRole("switch", { name: "Итоги звонков за день" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(toggle.hasAttribute("disabled")).toBe(false);
    expect(screen.getByText(/Активный Telegram-канал для них не нужен/)).toBeTruthy();
    expect(screen.getByText(/Каждый день в 09:00 МСК/)).toBeTruthy();
    fireEvent.click(toggle);
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith("/api/webapp/notification-center", {
      method: "PUT", body: JSON.stringify({ eventType: "telephony.daily_summary", enabled: false }),
    }));
    await waitFor(() => expect(toggle.hasAttribute("disabled")).toBe(false));
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));
    expect(screen.getByText(/Ежедневные итоги Novofon · в ленте приложения/)).toBeTruthy();
    expect(screen.queryByText(/Ежедневные итоги Novofon · приходят вам лично/)).toBeNull();
  });

  it("rolls back a failed preference change without losing its in-app delivery type", async () => {
    mocks.apiFetch.mockResolvedValueOnce(data).mockRejectedValueOnce(new Error("offline"));
    render(<NotificationCenterPage />);
    const toggle = await screen.findByRole("switch", { name: "Итоги звонков за день" });
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));
    expect(screen.getByText(/Ежедневные итоги Novofon · в ленте приложения/)).toBeTruthy();
    expect(mocks.haptic.notification).toHaveBeenCalledWith("error");
  });
});

describe("Center tells the truth (ADR 2026-10-25 §Q7, AC-C3.1/C3.5/C3.6)", () => {
  it("shows the delivery path caption, blockers, the bot hint and the transparency note", async () => {
    mocks.apiFetch.mockResolvedValue({
      ...data,
      role: "MANAGER",
      hint: { code: "START_BOT", text: "Запустите бота (нажмите Start), иначе сообщения в Telegram не приходят", botUrl: "https://t.me/DelovoyPark_bot" },
      categories: [{
        key: "bookings", label: "Бронирования", description: "Брони", icon: "calendar", delivery: "personal",
        events: [{
          eventType: "booking.created", label: "Новая бронь", description: "…", enabled: true, source: "default",
          caption: "Вы в списке получателей раздела «Барбекю Парк»",
          blockers: [{ code: "BOT_NOT_STARTED", label: "Бот не запущен" }],
        }],
      }],
    });
    render(<NotificationCenterPage />);
    expect(await screen.findByText("Вы в списке получателей раздела «Барбекю Парк»")).toBeTruthy();
    expect(screen.getByText("Не дойдёт: Бот не запущен")).toBeTruthy();
    expect(screen.getByText(/Запустите бота \(нажмите Start\)/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Открыть бота" })).toBeTruthy();
    expect(screen.getByText(data.transparencyNote)).toBeTruthy();
  });

  it("empty state comes from the server when there are no sections", async () => {
    mocks.apiFetch.mockResolvedValue({ ...data, categories: [], emptyState: "У вас пока нет разделов. Обратитесь к суперадмину" });
    render(<NotificationCenterPage />);
    expect(await screen.findByText("У вас пока нет разделов. Обратитесь к суперадмину")).toBeTruthy();
  });
});
