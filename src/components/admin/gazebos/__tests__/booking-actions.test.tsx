// @vitest-environment jsdom
//
// #436: роуты /checkin и /no-show существовали и были покрыты сервис-тестами,
// но ни одна кнопка UI их не вызывала — статус CHECKED_IN был недостижим
// вручную. Эти тесты гоняют реальный DOM (jsdom + @testing-library/react).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { BookingActions } from "../booking-actions";
import type { BookingStatus } from "@prisma/client";

function renderActions(currentStatus: BookingStatus) {
  render(
    <BookingActions
      bookingId="booking-1"
      currentStatus={currentStatus}
      clientName="Иван Петров"
      resourceName="Беседка №1"
      date="2026-09-01"
      startTime="10:00"
      endTime="12:00"
    />
  );
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

describe("BookingActions (gazebos) — Заехал / Не пришёл (#436)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    refreshMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("«Заехал» шлёт POST на выделенный роут /checkin для подтверждённой брони", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ success: true, data: { id: "booking-1", status: "CHECKED_IN" } })
    );

    renderActions("CONFIRMED");
    fireEvent.click(screen.getByText("Заехал"));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/gazebos/bookings/booking-1/checkin");
    expect((options as RequestInit).method).toBe("POST");
    expect((options as RequestInit).body).toBeUndefined();
  });

  it("«Заехал» доступен и для NO_SHOW — поздний заезд опоздавшего гостя", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ success: true, data: { id: "booking-1", status: "CHECKED_IN" } })
    );

    renderActions("NO_SHOW");
    fireEvent.click(screen.getByText("Заехал"));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/gazebos/bookings/booking-1/checkin");
  });

  it("показывает BOOKING_CONFLICT, если слот успели пересдать при позднем заезде", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        { success: false, error: { code: "BOOKING_CONFLICT", message: "Слот уже занят другой бронью" } },
        false,
        422
      )
    );

    renderActions("NO_SHOW");
    fireEvent.click(screen.getByText("Заехал"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Слот уже занят другой бронью");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("«Не пришёл» шлёт POST на выделенный роут /no-show", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ success: true, data: { id: "booking-1", status: "NO_SHOW" } })
    );

    renderActions("CONFIRMED");
    fireEvent.click(screen.getByText("Не пришёл"));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/gazebos/bookings/booking-1/no-show");
    expect((options as RequestInit).method).toBe("POST");
  });

  it("«Не пришёл» недоступен для уже заехавшего гостя", () => {
    renderActions("CHECKED_IN");

    expect(screen.queryByText("Не пришёл")).toBeNull();
  });

  it("не показывает «Заехал»/«Не пришёл» для брони, ожидающей подтверждения", () => {
    renderActions("PENDING");

    expect(screen.queryByText("Заехал")).toBeNull();
    expect(screen.queryByText("Не пришёл")).toBeNull();
  });
});
