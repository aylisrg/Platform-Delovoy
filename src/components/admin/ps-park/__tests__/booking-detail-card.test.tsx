// @vitest-environment jsdom
//
// #425: карточка брони в таймлайне слала PATCH и проверяла только `if (res.ok)`
// — при ошибке ничего не показывала, а «Завершить» отправляло PATCH
// { status: "COMPLETED" } без cashAmount/cardAmount, поэтому платные брони
// молча падали на серверном гейте PAYMENT_REQUIRED. Эти тесты гоняют реальный
// DOM (jsdom + @testing-library/react), а не только читают код компонента.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BookingDetailCard } from "../booking-detail-card";
import type { TimelineBooking, BookingBill } from "@/modules/ps-park/types";

const baseBooking: TimelineBooking = {
  id: "booking-1",
  resourceId: "table-1",
  startTime: "2026-09-01T10:00:00.000Z",
  endTime: "2026-09-01T12:00:00.000Z",
  status: "CONFIRMED",
  clientName: "Иван Петров",
  clientPhone: "+79991234567",
  cashAmount: null,
  cardAmount: null,
  metadata: { totalPrice: 2000 },
};

const bill: BookingBill = {
  bookingId: "booking-1",
  resourceName: "Стол №1",
  clientName: "Иван Петров",
  date: "2026-09-01",
  startTime: "10:00",
  endTime: "12:00",
  durationMin: 120,
  billedHours: 2,
  pricePerHour: 1000,
  hoursCost: 2000,
  items: [],
  itemsTotal: 0,
  totalBill: 2000,
  onlinePaidAmount: 0,
};

function renderCard(overrides: Partial<TimelineBooking> = {}) {
  const onStatusChanged = vi.fn();
  const onClose = vi.fn();
  render(
    <BookingDetailCard
      booking={{ ...baseBooking, ...overrides }}
      resourceName="Стол №1"
      pricePerHour={1000}
      isActiveNow={false}
      onClose={onClose}
      onStatusChanged={onStatusChanged}
    />
  );
  return { onStatusChanged, onClose };
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

describe("BookingDetailCard (ps-park)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  // #511: «Отменить» срабатывала с одного клика — бронь мгновенно уходила из
  // сетки, вернуть её было нечем. Теперь между кликом и PATCH стоит диалог.
  it("«Отменить» открывает подтверждение, а не шлёт PATCH сразу", async () => {
    renderCard();

    fireEvent.click(screen.getByText("Отменить"));

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("подтверждение отмены шлёт PATCH с причиной", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ success: true, data: { id: "booking-1", status: "CANCELLED" } })
    );

    const { onStatusChanged } = renderCard();
    fireEvent.click(screen.getByText("Отменить"));
    await screen.findByRole("dialog");

    fireEvent.change(screen.getByLabelText(/Причина отмены/), {
      target: { value: "Гость не приехал" },
    });
    fireEvent.click(screen.getByText("Да, отменить бронь"));

    await waitFor(() => expect(onStatusChanged).toHaveBeenCalled());
    const [, options] = vi.mocked(fetch).mock.calls[0];
    expect(JSON.parse((options as RequestInit).body as string)).toMatchObject({
      status: "CANCELLED",
      reason: "Гость не приехал",
    });
  });

  it("показывает ошибку сервера при отмене внутри диалога", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        { success: false, error: { code: "INVALID_STATUS_TRANSITION", message: "Нельзя отменить завершённую бронь" } },
        false,
        409
      )
    );

    const { onStatusChanged } = renderCard();
    fireEvent.click(screen.getByText("Отменить"));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByText("Да, отменить бронь"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Нельзя отменить завершённую бронь");
    expect(onStatusChanged).not.toHaveBeenCalled();
  });

  it("«Завершить» на платной брони подтягивает счёт и открывает модалку вместо прямого PATCH { status: COMPLETED }", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/bill")) return jsonResponse({ success: true, data: bill });
      if (url.includes("/settings")) return jsonResponse({ success: true, data: { maxDiscountPercent: 30 } });
      throw new Error(`unexpected fetch: ${url}`);
    });

    renderCard({ status: "CONFIRMED" });
    fireEvent.click(screen.getByText("Завершить"));

    expect(await screen.findByText("Итоговый чек")).toBeTruthy();

    const patchCalls = vi.mocked(fetch).mock.calls.filter(([url]) => !String(url).includes("/bill") && !String(url).includes("/settings"));
    expect(patchCalls).toHaveLength(0);
  });

  it("подтверждение чека отправляет PATCH с cashAmount/cardAmount, а не пустой { status: COMPLETED }", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/bill")) return jsonResponse({ success: true, data: bill });
      if (url.includes("/settings")) return jsonResponse({ success: true, data: { maxDiscountPercent: 30 } });
      if (init?.method === "PATCH") return jsonResponse({ success: true, data: { id: "booking-1", status: "COMPLETED" } });
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { onStatusChanged } = renderCard({ status: "CONFIRMED" });
    fireEvent.click(screen.getByText("Завершить"));
    await screen.findByText("Итоговый чек");

    fireEvent.click(screen.getByText("Завершить сессию"));
    // AC-1: между заполненным чеком и PATCH стоит последний вопрос.
    await screen.findByRole("dialog");
    expect(
      vi.mocked(fetch).mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "PATCH")
    ).toBe(false);
    fireEvent.click(screen.getByText("Да, завершить"));

    await waitFor(() => expect(onStatusChanged).toHaveBeenCalled());

    const patchCall = vi.mocked(fetch).mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PATCH");
    expect(patchCall).toBeTruthy();
    const body = JSON.parse((patchCall![1] as RequestInit).body as string);
    expect(body).toMatchObject({ status: "COMPLETED", cashAmount: 2000, cardAmount: 0 });
  });

  it("показывает ошибку, если загрузка счёта упала", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/bill")) return jsonResponse({ success: false, error: { message: "Бронирование не найдено" } }, false, 404);
      if (url.includes("/settings")) return jsonResponse({ success: true, data: { maxDiscountPercent: 30 } });
      throw new Error(`unexpected fetch: ${url}`);
    });

    renderCard({ status: "CONFIRMED" });
    fireEvent.click(screen.getByText("Завершить"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Бронирование не найдено");
  });

  // #436: роуты /checkin и /no-show существовали, но ни одна кнопка их не
  // вызывала — статус CHECKED_IN был недостижим вручную.
  describe("Заехал / Не пришёл (#436)", () => {
    it("«Заехал» шлёт POST на выделенный роут /checkin, не общий PATCH", async () => {
      vi.mocked(fetch).mockResolvedValue(
        jsonResponse({ success: true, data: { id: "booking-1", status: "CHECKED_IN" } })
      );

      const { onStatusChanged } = renderCard({ status: "CONFIRMED" });
      fireEvent.click(screen.getByText("Заехал"));

      await waitFor(() => expect(onStatusChanged).toHaveBeenCalled());
      const [url, options] = vi.mocked(fetch).mock.calls[0];
      expect(url).toBe("/api/ps-park/bookings/booking-1/checkin");
      expect((options as RequestInit).method).toBe("POST");
      expect((options as RequestInit).body).toBeUndefined();
    });

    it("показывает BOOKING_CONFLICT при позднем заезде на уже занятый стол", async () => {
      vi.mocked(fetch).mockResolvedValue(
        jsonResponse(
          { success: false, error: { code: "BOOKING_CONFLICT", message: "Стол уже занят другой бронью" } },
          false,
          422
        )
      );

      const { onStatusChanged } = renderCard({ status: "CONFIRMED" });
      fireEvent.click(screen.getByText("Заехал"));

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain("Стол уже занят другой бронью");
      expect(onStatusChanged).not.toHaveBeenCalled();
    });

    it("«Не пришёл» шлёт POST на выделенный роут /no-show", async () => {
      vi.mocked(fetch).mockResolvedValue(
        jsonResponse({ success: true, data: { id: "booking-1", status: "NO_SHOW" } })
      );

      const { onStatusChanged } = renderCard({ status: "CONFIRMED" });
      fireEvent.click(screen.getByText("Не пришёл"));

      await waitFor(() => expect(onStatusChanged).toHaveBeenCalled());
      const [url, options] = vi.mocked(fetch).mock.calls[0];
      expect(url).toBe("/api/ps-park/bookings/booking-1/no-show");
      expect((options as RequestInit).method).toBe("POST");
    });

    it("не показывает «Заехал»/«Не пришёл» для брони, ожидающей подтверждения", () => {
      renderCard({ status: "PENDING" });

      expect(screen.queryByText("Заехал")).toBeNull();
      expect(screen.queryByText("Не пришёл")).toBeNull();
    });

    // Регрессия: до #436 «Завершить» показывалось только для CONFIRMED — раз
    // CHECKED_IN стал достижим руками, заехавшую сессию нечем было бы закрыть.
    it("заехавшую сессию можно завершить — «Завершить» показывается и для CHECKED_IN", () => {
      renderCard({ status: "CHECKED_IN" });

      expect(screen.queryByRole("button", { name: "Заехал" })).toBeNull();
      expect(screen.queryByText("Не пришёл")).toBeNull();
      expect(screen.getByText("Завершить")).toBeTruthy();
    });

    it("бейдж статуса показывает «Играет» для CHECKED_IN", () => {
      renderCard({ status: "CHECKED_IN" });

      expect(screen.getByText("Играет")).toBeTruthy();
      expect(screen.queryByText("Подтверждена")).toBeNull();
    });
  });
});
