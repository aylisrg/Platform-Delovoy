// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessAnalytics, BusinessReportView } from "../business-analytics";
import type { BusinessPreference, BusinessReport } from "@/modules/analytics/business-types";

const zero = { receipts: 0, refunds: 0, adjustments: 0, net: 0, cash: 0, card: 0, online: 0 };
const report: BusinessReport = {
  period: { from: "2026-10-19", to: "2026-10-25", timezone: "Europe/Moscow", days: 7 },
  generatedAt: "2026-10-26T06:00:00Z", totals: { ...zero, receipts: 1500, refunds: 2000, net: -500, online: 1500 }, previous: zero,
  lines: [{ ...zero, slug: "gazebos", label: "Барбекю Парк", bookings: 0, completed: 0, cancelled: 0, noShows: 0, orders: 0, linkedOrders: 0, knownCustomers: 0, repeatCustomers: 0, unidentifiedOperations: 0, coverage: "Ручные предоплаты могут отсутствовать." }],
  daily: [{ ...zero, date: "2026-10-19", receipts: 1500, refunds: 2000, net: -500 }],
  funnel: [{ slug: "gazebos", views: 0, started: 0, submitted: 0, paid: 0 }],
  quality: { excludedLedgerRows: 0, duplicateLedgerRows: 0, unknownPaymentRows: 0, warnings: ["Частичный учёт"] },
  marketing: { visits: null, adSpend: null, clicks: 0, fetchedAt: "2026-10-26T06:00:00Z", scope: "Весь сайт, включая офисы; вне бизнес-итогов." },
};
const preference: BusinessPreference = { enabled: false, telegramReady: true, timezone: "Europe/Moscow", schedule: "Понедельник после 09:00 МСК", lastDelivery: null };
const request = vi.fn();
const apiFetch = async <T,>(url: string, options?: RequestInit): Promise<T> => request(url, options) as Promise<T>;
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/admin/analytics/business");
  request.mockImplementation(async (url: string) => url.endsWith("/subscription") ? preference : report);
});
afterEach(cleanup);

describe("Business analytics interface", () => {
  it("separates missing marketing data, zero and negative net cash, and explains coverage", () => {
    render(<BusinessReportView report={report} />);
    expect(screen.getAllByText("Нет данных")).toHaveLength(2);
    expect(screen.getByText("Частичное покрытие кассы")).toBeTruthy();
    expect(screen.getByText("Ручные предоплаты могут отсутствовать.")).toBeTruthy();
    expect(screen.getAllByText(/-500/).length).toBeGreaterThan(0);
    expect(screen.getByText("Демонстрационные данные — исключены из всех бизнес-итогов и отчётов.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /19.10: поступления/ }).getAttribute("aria-label")).toContain("-500");
  });

  it("passes the Telegram exact-week anchor and clears it on choosing another period", async () => {
    window.history.replaceState(null, "", "/admin/analytics/business?weekEnding=2026-10-25");
    render(<BusinessAnalytics apiFetch={apiFetch} />);
    await screen.findByText("Учтённые поступления");
    expect(request).toHaveBeenCalledWith("/api/analytics/business?period=7d&weekEnding=2026-10-25", expect.any(Object));
    fireEvent.click(screen.getByRole("button", { name: "30 дней" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/analytics/business?period=30d", expect.any(Object)));
  });

  it("removes old financial figures when a new period is denied", async () => {
    request.mockImplementation(async (url: string) => {
      if (url.endsWith("/subscription")) return preference;
      if (url.includes("period=30d")) throw new Error("Доступ отозван");
      return report;
    });
    render(<BusinessAnalytics apiFetch={apiFetch} />);
    await screen.findByText("Учтённые поступления");
    fireEvent.click(screen.getByRole("button", { name: "30 дней" }));
    await screen.findByRole("alert");
    expect(screen.queryByText("Учтённые поступления")).toBeNull();
    expect(screen.getByText("Доступ отозван")).toBeTruthy();
  });

  it("does not turn the weekly switch on after a failed save", async () => {
    request.mockImplementation(async (url: string, options?: RequestInit) => {
      if (options?.method === "PUT") throw new Error("Сохранение не выполнено");
      return url.endsWith("/subscription") ? preference : report;
    });
    render(<BusinessAnalytics apiFetch={apiFetch} />);
    const toggle = await screen.findByRole("switch", { name: "Недельный бизнес-отчёт" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    await screen.findByText("Сохранение не выполнено");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(request).toHaveBeenCalledWith("/api/analytics/business/subscription", { method: "PUT", body: '{"enabled":true}' });
  });

  it("keeps one test id across retries and never calls uncertain delivery success", async () => {
    let attempts = 0;
    request.mockImplementation(async (url: string) => {
      if (url.endsWith("/test")) {
        attempts++;
        if (attempts === 1) throw new Error("Соединение потеряно");
        return { sent: false, status: "UNKNOWN" };
      }
      return url.endsWith("/subscription") ? preference : report;
    });
    render(<BusinessAnalytics apiFetch={apiFetch} />);
    fireEvent.click(await screen.findByRole("button", { name: "Отправить мне тест" }));
    await screen.findByText("Соединение потеряно");
    expect(screen.queryByText("Тестовый отчёт доставлен в ваш личный Telegram.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Отправить мне тест" }));
    await waitFor(() => expect(request.mock.calls.filter(call => String(call[0]).endsWith("/test"))).toHaveLength(2));
    const calls = request.mock.calls.filter(call => String(call[0]).endsWith("/test"));
    expect(calls[0][1].body).toBe(calls[1][1].body);
    expect(Object.keys(JSON.parse(calls[0][1].body))).toEqual(["requestId"]);
    await screen.findByText(/Исход доставки неизвестен/);
    expect(screen.getByRole("button", { name: "Исход неизвестен" }).hasAttribute("disabled")).toBe(true);
  });

  it("uses Mini App authenticated transport and marks a test delivered only after confirmation", async () => {
    request.mockImplementation(async (url: string) => {
      if (url.endsWith("/test")) return { sent: true };
      return url.endsWith("/subscription") ? preference : report;
    });
    render(<BusinessAnalytics miniApp apiFetch={apiFetch} />);
    fireEvent.click(await screen.findByRole("button", { name: "Отправить мне тест" }));
    await screen.findByText("Тестовый отчёт доставлен в ваш личный Telegram.");
    expect(request).toHaveBeenCalledWith("/api/webapp/business-analytics/test", expect.any(Object));
    expect(screen.queryByRole("button", { name: "CSV" })).toBeNull();
    expect(screen.getByRole("button", { name: "Тест доставлен" }).hasAttribute("disabled")).toBe(true);
  });
});
