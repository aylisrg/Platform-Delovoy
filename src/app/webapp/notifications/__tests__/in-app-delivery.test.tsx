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
  categories: [{ key: "telephony", label: "Звонки", description: "Ежедневные итоги Novofon", icon: "bell", delivery: "in-app", events: [{ eventType: "telephony.daily_summary", label: "Итоги звонков за день", description: "Всего, принято и пропущено", enabled: true, source: "default" }] }],
  protected: [],
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
