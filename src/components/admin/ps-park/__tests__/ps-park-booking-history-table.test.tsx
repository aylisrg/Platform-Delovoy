// @vitest-environment jsdom
//
// #438: «гость звонит: я бронировал» — поиск по имени/телефону в истории.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { role: "SUPERADMIN" } } }),
}));

import { PSParkBookingHistoryTable } from "../ps-park-booking-history-table";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

describe("PSParkBookingHistoryTable — поиск по имени/телефону (#438)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    cleanup();
  });

  it("вводит search в query-параметры после дебаунса, не на каждое нажатие", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ success: true, data: [], meta: { total: 0 } })
    );

    render(<PSParkBookingHistoryTable />);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByPlaceholderText("Поиск: имя, телефон"), {
      target: { value: "Петров" },
    });

    // Сразу после ввода — ещё не должно быть нового запроса (дебаунс 300мс).
    expect(fetch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(300);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    const lastCall = vi.mocked(fetch).mock.calls[1][0] as string;
    expect(lastCall).toContain("search=");
  });

  it("не шлёт search, если поле пустое", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ success: true, data: [], meta: { total: 0 } })
    );

    render(<PSParkBookingHistoryTable />);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    const firstCall = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(firstCall).not.toContain("search=");
  });
});
