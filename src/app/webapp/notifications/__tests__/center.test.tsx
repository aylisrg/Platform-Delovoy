// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(), user: { id: "fixture", role: "SUPERADMIN" },
  capabilities: { isStaff: true, staffSections: ["analytics"], notificationCategories: [] as string[], canNotificationCenter: true },
  showBackButton: vi.fn(), onBackButtonClick: vi.fn(), router: { push: vi.fn() },
  haptic: { selection: vi.fn(), notification: vi.fn() },
}));
vi.mock("@/components/webapp/TelegramProvider", () => ({
  useTelegram: () => ({ ready: true, ...mocks }),
  ApiFetchError: class extends Error { status: number; constructor(args: { status: number; message: string }) { super(args.message); this.status = args.status; } },
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
import NotificationCenterPage from "../page";
import { ApiFetchError } from "@/components/webapp/TelegramProvider";
import { canViewBusinessAnalytics, GUEST_CAPABILITIES } from "@/lib/webapp/types";

const businessUrl = "/api/webapp/business-analytics/subscription";
let enabled = false;
let telegramReady = true;
let rejectSave = false;
let revoke = false;
let commitThenDisconnect = false;
let readFails = false;
const preference = () => ({ enabled, telegramReady, schedule: "Понедельник после 09:00 МСК", timezone: "Europe/Moscow", lastDelivery: null });
beforeEach(() => {
  vi.clearAllMocks(); enabled = false; telegramReady = true; rejectSave = false; revoke = false; commitThenDisconnect = false; readFails = false;
  mocks.user.role = "SUPERADMIN";
  mocks.capabilities = { isStaff: true, staffSections: ["analytics"], notificationCategories: [], canNotificationCenter: true };
  mocks.apiFetch.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url === businessUrl) {
      if (revoke) throw new ApiFetchError({ status: 403, message: "Доступ отозван", code: "FORBIDDEN" });
      if (options?.method === "PUT") {
        if (rejectSave) throw new Error("offline");
        enabled = JSON.parse(String(options.body)).enabled;
        if (commitThenDisconnect) throw new Error("response lost after commit");
      }
      if (readFails) throw new Error("offline");
      return preference();
    }
    if (url === "/api/webapp/preferences") return { preferences: { enableBooking: true, enableOrder: true, enableReminder: true, preferredChannel: "AUTO" }, availableChannels: [{ channel: "TELEGRAM", connected: true }] };
    if (url === "/api/webapp/notification-center") return { role: mocks.user.role, channel: { kind: "TELEGRAM", status: "active" }, categories: [], protected: [], emptyState: null, hint: null };
    throw new Error(`Unexpected endpoint: ${url}`);
  });
});
afterEach(cleanup);

describe("Unified notification center", () => {
  it.each(["USER", "MANAGER", "ADMIN"])("%s without analytics cannot see or request business settings", async role => {
    mocks.user.role = role;
    mocks.capabilities = { ...GUEST_CAPABILITIES, isStaff: role !== "USER" };
    render(<NotificationCenterPage />);
    expect(await screen.findByRole("switch", { name: "Бронирования" })).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "Недельный бизнес-отчёт" })).toBeNull();
    expect(mocks.apiFetch.mock.calls.some(([url]) => String(url).includes("business-analytics"))).toBe(false);
    if (role === "USER") expect(mocks.apiFetch.mock.calls.some(([url]) => url === "/api/webapp/notification-center")).toBe(false);
  });
  it("persists explicit on/off across re-entry without touching other preferences or sending a test", async () => {
    mocks.user.role = "ADMIN";
    const view = render(<NotificationCenterPage />);
    const toggle = await screen.findByRole("switch", { name: "Недельный бизнес-отчёт" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(mocks.apiFetch.mock.calls.some(([, options]) => options?.method === "PUT")).toBe(false);
    fireEvent.click(toggle);
    await screen.findByText("Настройка сохранена");
    expect(enabled).toBe(true);
    view.unmount(); render(<NotificationCenterPage />);
    const reopened = await screen.findByRole("switch", { name: "Недельный бизнес-отчёт" });
    expect(reopened.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(reopened);
    await waitFor(() => expect(enabled).toBe(false));
    expect(mocks.apiFetch.mock.calls.filter(([, options]) => options?.method === "PUT").map(([url]) => url)).toEqual([businessUrl, businessUrl]);
    expect(mocks.apiFetch.mock.calls.some(([url]) => String(url).endsWith("/test"))).toBe(false);
  });
  it("keeps the saved state on a failed write and removes business controls after live denial", async () => {
    render(<NotificationCenterPage />);
    const toggle = await screen.findByRole("switch", { name: "Недельный бизнес-отчёт" });
    rejectSave = true; fireEvent.click(toggle);
    await screen.findByRole("alert");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    rejectSave = false; revoke = true; fireEvent.click(toggle);
    await waitFor(() => expect(screen.queryByRole("switch", { name: "Недельный бизнес-отчёт" })).toBeNull());
    expect(screen.getByRole("switch", { name: "Бронирования" })).toBeTruthy();
  });
  it("missing Telegram blocks opt-in but still permits an existing opt-out", async () => {
    telegramReady = false;
    const view = render(<NotificationCenterPage />);
    expect((await screen.findByRole("switch", { name: "Недельный бизнес-отчёт" })).hasAttribute("disabled")).toBe(true);
    view.unmount(); enabled = true; render(<NotificationCenterPage />);
    const toggle = await screen.findByRole("switch", { name: "Недельный бизнес-отчёт" });
    expect(toggle.hasAttribute("disabled")).toBe(false);
    fireEvent.click(toggle); await waitFor(() => expect(enabled).toBe(false));
  });
  it("reconciles a committed PUT whose response was lost instead of showing a false opt-out", async () => {
    render(<NotificationCenterPage />);
    const toggle = await screen.findByRole("switch", { name: "Недельный бизнес-отчёт" });
    commitThenDisconnect = true;
    fireEvent.click(toggle);
    await screen.findByRole("alert");
    expect(enabled).toBe(true);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });
  it("blocks another write while the committed state cannot be reconciled", async () => {
    render(<NotificationCenterPage />);
    const toggle = await screen.findByRole("switch", { name: "Недельный бизнес-отчёт" });
    commitThenDisconnect = true; readFails = true;
    fireEvent.click(toggle);
    await screen.findByText("Статус не подтверждён");
    expect(toggle.hasAttribute("disabled")).toBe(true);
    readFails = false;
    fireEvent.click(screen.getByRole("button", { name: "Обновить статус подписки" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Недельный бизнес-отчёт" }).getAttribute("aria-checked")).toBe("true"));
  });
  it("a manager cannot get the navigation hint even with an analytics section", () => {
    expect(canViewBusinessAnalytics({ role: "MANAGER" }, mocks.capabilities)).toBe(false);
    expect(canViewBusinessAnalytics(null, mocks.capabilities)).toBe(false);
  });
});
