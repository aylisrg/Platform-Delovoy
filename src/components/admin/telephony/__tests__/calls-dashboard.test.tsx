// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TelephonyDashboard } from "@/modules/telephony/dashboard-types";
import { CallsDashboard } from "../calls-dashboard";

function dashboard(overrides: Partial<TelephonyDashboard> = {}): TelephonyDashboard {
  return {
    period: "today", dateFrom: "2026-10-24", dateTo: "2026-10-24", timeZone: "Europe/Moscow",
    summary: { total: 8, inbound: 6, answered: 3, missed: 2, outbound: 2, pending: 1, answerRate: 60, avgTalkSeconds: 90 },
    daily: [{ date: "2026-10-24", total: 8, inbound: 6, answered: 3, missed: 2, outbound: 2, pending: 1 }],
    calls: [{ id: "call-1", startedAt: "2026-10-24T08:00:00.000Z", direction: "INBOUND", outcome: "pending", maskedPhone: "+7 *** ***-12-34", employeeName: null, talkDuration: null, waitDuration: null, isLost: false }],
    pagination: { page: 1, perPage: 25, total: 8, totalPages: 1 },
    source: { dataApiConfigured: true, webhookConfigured: true, lastCallAt: "2026-10-24T08:00:00.000Z", lastJournalUpdate: "2026-10-24T08:05:00.000Z" },
    ...overrides,
  };
}

function response(data = dashboard()) {
  return { ok: true, status: 200, json: async () => ({ success: true, data }) };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CallsDashboard", () => {
  it("shows aggregate metrics, masked numbers and honest unknown/configuration states", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));
    render(<CallsDashboard />);
    expect(await screen.findByRole("button", { name: "Всего звонков: 8. Показать в журнале" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Пропущенные: 2. Показать в журнале" })).toBeTruthy();
    expect(screen.getAllByText("+7 *** ***-12-34").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Уточняется").length).toBeGreaterThan(0);
    expect(screen.getByText(/У 1 входящих результат уточняется/)).toBeTruthy();
    expect(screen.getByText("60%")).toBeTruthy();
    expect(screen.getByText(/Последнее изменение журнала: 24-10-2026 11:05 МСК/)).toBeTruthy();
    expect(screen.queryByText("Подключено")).toBeNull();
    expect(document.querySelector('a[href^="tel:"]')).toBeNull();
  });

  it("opens the missed deep link and filters without changing period-wide statistics", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    vi.stubGlobal("fetch", fetchMock);
    render(<CallsDashboard initialFilter="missed" />);
    await screen.findByRole("button", { name: "Всего звонков: 8. Показать в журнале" });
    expect(fetchMock.mock.calls[0][0]).toContain("filter=missed");
    expect(screen.getByRole("button", { name: "Пропущенные 2" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Входящие 6" }));
    await waitFor(() => expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("filter=inbound&page=1"));
    expect(screen.getByRole("button", { name: "Всего звонков: 8. Показать в журнале" })).toBeTruthy();
  });

  it("resets pagination for a changed filter or period", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const query = new URL(url, "http://localhost").searchParams;
      return response(dashboard({ period: query.get("period") === "7d" ? "7d" : "today", pagination: { page: Number(query.get("page")), perPage: 25, total: 60, totalPages: 3 } }));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<CallsDashboard />);
    await screen.findByText("1–25 из 60");
    fireEvent.click(screen.getByRole("button", { name: "Далее" }));
    await screen.findByText("26–50 из 60");
    fireEvent.click(screen.getByRole("button", { name: "Пропущенные 2" }));
    await screen.findByText("1–25 из 60");
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("filter=missed&page=1");
    fireEvent.click(screen.getByRole("button", { name: "Далее" }));
    await screen.findByText("26–50 из 60");
    fireEvent.click(screen.getByRole("button", { name: "7 дней" }));
    await screen.findByText("1–25 из 60");
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("period=7d&filter=missed&page=1");
  });

  it("focuses the journal after loading the requested missed filter", async () => {
    let resolveMissed: (value: ReturnType<typeof response>) => void = () => {};
    const pending = new Promise<ReturnType<typeof response>>((resolve) => { resolveMissed = resolve; });
    const fetchMock = vi.fn().mockResolvedValueOnce(response()).mockReturnValueOnce(pending);
    vi.stubGlobal("fetch", fetchMock);
    render(<CallsDashboard />);
    fireEvent.click(await screen.findByRole("button", { name: "Показать пропущенные" }));
    await screen.findByText("Загружаем звонки…");
    expect(screen.getByRole("button", { name: "Всего звонков: 8. Показать в журнале" })).toBeTruthy();
    expect(screen.queryByText("Номер не определён")).toBeNull();
    await act(async () => { resolveMissed(response()); });
    expect(document.activeElement?.getAttribute("aria-labelledby")).toBe("calls-journal-title");
  });

  it("ignores a stale response when periods are changed quickly", async () => {
    let resolveFirst: (value: ReturnType<typeof response>) => void = () => {};
    const first = new Promise<ReturnType<typeof response>>((resolve) => { resolveFirst = resolve; });
    const fetchMock = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(response(dashboard({ period: "7d", summary: { ...dashboard().summary, total: 42 } })));
    vi.stubGlobal("fetch", fetchMock);
    render(<CallsDashboard />);
    fireEvent.click(screen.getByRole("button", { name: "7 дней" }));
    await screen.findByRole("button", { name: "Всего звонков: 42. Показать в журнале" });
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    await act(async () => { resolveFirst(response()); });
    expect(screen.getByRole("button", { name: "Всего звонков: 42. Показать в журнале" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Всего звонков: 8. Показать в журнале" })).toBeNull();
  });

  it("does not turn request failure into zero calls and supports retry", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("network failure")).mockResolvedValueOnce(response()));
    render(<CallsDashboard />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("За этот период звонков пока нет")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Всего звонков:/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    await screen.findByRole("button", { name: "Всего звонков: 8. Показать в журнале" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("retains previous results with an explicit warning when refresh fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ success: false }) }));
    render(<CallsDashboard />);
    await screen.findByRole("button", { name: "Всего звонков: 8. Показать в журнале" });
    fireEvent.click(screen.getByRole("button", { name: "Обновить статистику звонков" }));
    expect(await screen.findByText(/Показаны ранее загруженные данные/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Всего звонков: 8. Показать в журнале" })).toBeTruthy();
  });

  it("distinguishes an empty period from an unconfigured integration", async () => {
    const empty = dashboard({ summary: { total: 0, inbound: 0, answered: 0, missed: 0, outbound: 0, pending: 0, answerRate: null, avgTalkSeconds: null }, calls: [], pagination: { page: 1, perPage: 25, total: 0, totalPages: 0 }, source: { dataApiConfigured: false, webhookConfigured: false, lastCallAt: null, lastJournalUpdate: null } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(empty)));
    render(<CallsDashboard />);
    expect(await screen.findByText("За этот период звонков пока нет")).toBeTruthy();
    expect(screen.getByText(/Подключение не настроено/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Далее" }).hasAttribute("disabled")).toBe(true);
  });

  it("polls only while visible and aborts an in-flight request on unmount", async () => {
    vi.useFakeTimers();
    let visibility: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    const fetchMock = vi.fn().mockResolvedValue(response());
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<CallsDashboard />);
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    visibility = "hidden";
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    visibility = "visible";
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockImplementationOnce(() => new Promise(() => {}));
    await act(async () => { vi.advanceTimersByTime(60_000); });
    const signal = (fetchMock.mock.calls.at(-1)?.[1] as RequestInit).signal;
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });
});
