// @vitest-environment jsdom
//
// #425: карточка брони в таймлайне слала PATCH и проверяла только `if (res.ok)`
// — при ошибке ничего не показывала, а «Завершить» отправляло пустой
// { status: "COMPLETED" } без cashAmount/cardAmount, поэтому платные брони
// молча падали на серверном гейте PAYMENT_REQUIRED. Эти тесты гоняют реальный
// DOM (jsdom + @testing-library/react), а не только читают код компонента.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GazeboBookingDetailCard } from "../booking-detail-card";
import type { TimelineBooking } from "@/modules/gazebos/types";

const baseBooking: TimelineBooking = {
  id: "booking-1",
  resourceId: "resource-1",
  startTime: "2026-09-01T10:00:00.000Z",
  endTime: "2026-09-01T12:00:00.000Z",
  status: "CONFIRMED",
  clientName: "Иван Петров",
  clientPhone: "+79991234567",
  metadata: { totalPrice: 3000, pricePerHour: 1500 },
};

function renderCard(overrides: Partial<TimelineBooking> = {}) {
  const onStatusChanged = vi.fn();
  const onClose = vi.fn();
  render(
    <GazeboBookingDetailCard
      booking={{ ...baseBooking, ...overrides }}
      resourceName="Беседка №1"
      pricePerHour={1500}
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

describe("GazeboBookingDetailCard", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("показывает ошибку сервера при отмене вместо молчаливого игнорирования", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        { success: false, error: { code: "INVALID_STATUS_TRANSITION", message: "Нельзя отменить завершённую бронь" } },
        false,
        409
      )
    );

    const { onStatusChanged } = renderCard();
    fireEvent.click(screen.getByText("Отменить"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Нельзя отменить завершённую бронь");
    expect(onStatusChanged).not.toHaveBeenCalled();
  });

  it("«Завершить» на платной брони открывает окно счёта вместо прямого PATCH", async () => {
    renderCard({ status: "CONFIRMED" });

    fireEvent.click(screen.getByText("Завершить"));

    expect(await screen.findByText("Завершение брони беседки")).toBeTruthy();
    // Счёт для gazebos уже в metadata брони — открытие модалки не требует запроса.
    expect(fetch).not.toHaveBeenCalled();
  });

  it("подтверждение счёта отправляет cashAmount/cardAmount, а не пустой PATCH", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ success: true, data: { id: "booking-1", status: "COMPLETED" } })
    );

    const { onStatusChanged } = renderCard({ status: "CONFIRMED" });
    fireEvent.click(screen.getByText("Завершить"));
    await screen.findByText("Завершение брони беседки");

    fireEvent.click(screen.getByText("Завершить бронь"));

    await waitFor(() => expect(onStatusChanged).toHaveBeenCalled());

    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/gazebos/bookings/booking-1");
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body).toMatchObject({ status: "COMPLETED", cashAmount: 3000, cardAmount: 0 });
  });

  it("показывает PAYMENT_REQUIRED из ответа сервера внутри окна счёта", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        { success: false, error: { code: "PAYMENT_REQUIRED", message: "Необходимо принять оплату: не хватает 500 ₽" } },
        false,
        422
      )
    );

    renderCard({ status: "CONFIRMED" });
    fireEvent.click(screen.getByText("Завершить"));
    await screen.findByText("Завершение брони беседки");

    fireEvent.click(screen.getByText("Завершить бронь"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Необходимо принять оплату: не хватает 500 ₽");
  });
});
