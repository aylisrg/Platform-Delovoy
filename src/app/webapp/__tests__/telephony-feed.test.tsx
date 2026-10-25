// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  push: vi.fn(),
  user: { id: "owner", name: "Владелец", role: "SUPERADMIN" },
  capabilities: { isStaff: true, staffSections: [], notificationCategories: [], canNotificationCenter: true },
  haptic: { impact: vi.fn(), selection: vi.fn(), notification: vi.fn() },
}));
vi.mock("@/components/webapp/TelegramProvider", () => ({
  useTelegram: () => ({ ready: true, user: mocks.user, capabilities: mocks.capabilities, apiFetch: mocks.apiFetch, haptic: mocks.haptic }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));

import WebAppHome from "../page";

const summary = {
  reportDate: "2026-10-23", timeZone: "Europe/Moscow", generatedAt: "2026-10-24T06:00:00.000Z",
  total: 18, inbound: 14, answered: 10, missed: 3, outbound: 4, pending: 1, answerRate: 76.9,
};
const item = {
  id: "in:daily-1", kind: "personal", eventType: "telephony.daily_summary",
  title: "Звонки за 23-10-2026", body: "Всего 18. Принято 10. Пропущено 3.",
  actions: [{ label: "Случайная ссылка", url: "/admin/telephony" }],
  createdAt: "2026-10-24T06:00:00.000Z", readAt: null, moduleSlug: "telephony", telephonySummary: summary,
};

beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);

function feed(value: object) {
  mocks.apiFetch.mockImplementation(async (url: string) => {
    if (url.startsWith("/api/webapp/feed?")) return { items: [value], nextCursor: null, unreadCount: 1 };
    if (url === "/api/webapp/feed/read") return { updated: 1, unreadCount: 0, feedSeenAt: null };
    if (url === "/api/webapp/feed/open") return { readAt: "2026-10-24T06:00:00.000Z", clicked: false };
    throw new Error("unexpected request");
  });
}

describe("Daily telephony report in the Mini App feed", () => {
  it("uses the native summary card and marks it read without following any action URL", async () => {
    feed(item);
    render(<WebAppHome />);
    fireEvent.click(await screen.findByRole("button", { name: "Подробнее о звонках за 23-10-2026" }));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith("/api/webapp/feed/open", {
      method: "POST", body: JSON.stringify({ id: "in:daily-1" }),
    }));
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.queryByRole("img", { name: "Не прочитано" })).toBeNull();
    expect(screen.getByText("24-10-2026 09:00 МСК")).toBeTruthy();
  });

  it.each([undefined, { ...summary, missed: -1 }])("falls back to the text feed card for missing or malformed summary data", async (telephonySummary) => {
    feed({ ...item, telephonySummary, actions: [] });
    render(<WebAppHome />);
    expect(await screen.findByText(item.title)).toBeTruthy();
    expect(screen.getByText(item.body)).toBeTruthy();
    expect(screen.queryByRole("article", { name: "Звонки за день" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Подробнее о звонках/ })).toBeNull();
  });

  it("keeps the existing unavailable-feed state instead of fabricating a zero report", async () => {
    mocks.apiFetch.mockRejectedValue(new Error("offline"));
    render(<WebAppHome />);
    expect(await screen.findByText("Лента недоступна")).toBeTruthy();
    expect(screen.queryByRole("article", { name: "Звонки за день" })).toBeNull();
  });
});
