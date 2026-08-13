// @vitest-environment jsdom
//
// #436: NO_SHOW-бронь не входит в ACTIVE_BOOKING_STATUSES и не попадает в
// сетку расписания — единственное место, где её видно и можно отметить
// поздний заезд (NO_SHOW → CHECKED_IN, конфликт-чек #478), это история броней.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: pushMock }),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { role: "SUPERADMIN" } } }),
}));

import { GazeboBookingHistoryTable } from "../booking-history-table";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

const noShowBooking = {
  id: "booking-1",
  date: "2026-09-01T00:00:00.000Z",
  startTime: "2026-09-01T10:00:00.000Z",
  endTime: "2026-09-01T12:00:00.000Z",
  status: "NO_SHOW",
  clientName: "Иван Петров",
  clientPhone: "+79991234567",
  metadata: {},
  cashAmount: null,
  cardAmount: null,
  resource: { name: "Беседка №1" },
};

describe("GazeboBookingHistoryTable — поздний заезд NO_SHOW (#436)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("показывает «Заехал» только для строк со статусом NO_SHOW", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ success: true, data: [noShowBooking], meta: { total: 1 } })
    );

    render(<GazeboBookingHistoryTable />);

    await screen.findByText("Иван Петров");
    expect(screen.getByRole("button", { name: "Заехал" })).toBeTruthy();
  });

  it("не показывает «Заехал» для подтверждённой брони", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        success: true,
        data: [{ ...noShowBooking, status: "CONFIRMED" }],
        meta: { total: 1 },
      })
    );

    render(<GazeboBookingHistoryTable />);

    await screen.findByText("Иван Петров");
    expect(screen.queryByRole("button", { name: "Заехал" })).toBeNull();
  });

  it("клик «Заехал» шлёт POST на /checkin, а не открывает бронь в расписании", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/checkin")) {
        return jsonResponse({ success: true, data: { id: "booking-1", status: "CHECKED_IN" } });
      }
      // Повторный вызов loadBookings() после успешного заезда.
      return jsonResponse({ success: true, data: [noShowBooking], meta: { total: 1 } });
    });

    render(<GazeboBookingHistoryTable />);
    await screen.findByText("Иван Петров");

    fireEvent.click(screen.getByRole("button", { name: "Заехал" }));

    await waitFor(() => {
      const checkinCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes("/checkin"));
      expect(checkinCall).toBeTruthy();
    });
    const checkinCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes("/checkin"))!;
    expect(checkinCall[0]).toBe("/api/gazebos/bookings/booking-1/checkin");
    expect((checkinCall[1] as RequestInit).method).toBe("POST");
    // Клик по кнопке не должен перебросить в расписание (stopPropagation).
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("показывает тост с ошибкой, если слот успели пересдать", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/checkin")) {
        return jsonResponse(
          { success: false, error: { code: "BOOKING_CONFLICT", message: "Слот уже занят другой бронью" } },
          false,
          422
        );
      }
      return jsonResponse({ success: true, data: [noShowBooking], meta: { total: 1 } });
    });

    render(<GazeboBookingHistoryTable />);
    await screen.findByText("Иван Петров");

    fireEvent.click(screen.getByRole("button", { name: "Заехал" }));

    expect(await screen.findByText("Слот уже занят другой бронью")).toBeTruthy();
  });

  it("фильтр статусов включает опцию CHECKED_IN", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ success: true, data: [], meta: { total: 0 } })
    );

    render(<GazeboBookingHistoryTable />);

    expect(await screen.findByRole("option", { name: "Заехал" })).toBeTruthy();
  });
});
