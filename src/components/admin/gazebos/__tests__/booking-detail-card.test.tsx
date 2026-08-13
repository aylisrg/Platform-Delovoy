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
  cashAmount: null,
  cardAmount: null,
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

  // #511: «Отменить» срабатывала с одного клика — бронь мгновенно уходила из
  // сетки, вернуть её было нечем. Теперь между кликом и PATCH стоит диалог.
  it("«Отменить» открывает подтверждение, а не шлёт PATCH сразу", async () => {
    renderCard();

    fireEvent.click(screen.getByText("Отменить"));

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Да, отменить бронь")).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("закрытие диалога отмены не трогает бронь", async () => {
    const { onStatusChanged } = renderCard();
    fireEvent.click(screen.getByText("Отменить"));
    await screen.findByRole("dialog");

    fireEvent.click(screen.getByText("Не сейчас"));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(fetch).not.toHaveBeenCalled();
    expect(onStatusChanged).not.toHaveBeenCalled();
  });

  it("подтверждение отмены шлёт PATCH с причиной", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ success: true, data: { id: "booking-1", status: "CANCELLED" } })
    );

    const { onStatusChanged } = renderCard();
    fireEvent.click(screen.getByText("Отменить"));
    await screen.findByRole("dialog");

    fireEvent.change(screen.getByLabelText(/Причина отмены/), {
      target: { value: "Гость отказался" },
    });
    fireEvent.click(screen.getByText("Да, отменить бронь"));

    await waitFor(() => expect(onStatusChanged).toHaveBeenCalled());
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/gazebos/bookings/booking-1");
    expect(JSON.parse((options as RequestInit).body as string)).toMatchObject({
      status: "CANCELLED",
      reason: "Гость отказался",
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
    // Диалог остаётся открытым — менеджер видит, что действие не прошло.
    expect(screen.queryByRole("dialog")).toBeTruthy();
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
    // AC-1: между заполненным счётом и PATCH стоит последний вопрос.
    await screen.findByRole("dialog");
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Да, завершить"));

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
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByText("Да, завершить"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Необходимо принять оплату: не хватает 500 ₽");
  });

  it("отказ в последнем вопросе не завершает бронь и сохраняет заполненный счёт", async () => {
    const { onStatusChanged } = renderCard({ status: "CONFIRMED" });
    fireEvent.click(screen.getByText("Завершить"));
    await screen.findByText("Завершение брони беседки");

    fireEvent.click(screen.getByText("Завершить бронь"));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByText("Не сейчас"));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(fetch).not.toHaveBeenCalled();
    expect(onStatusChanged).not.toHaveBeenCalled();
    // Счёт остался открытым — менеджер не набирает суммы заново.
    expect(screen.getByText("Завершение брони беседки")).toBeTruthy();
  });
});

// #511, вторая итерация: владелец не находил, «как поменять статус» и где
// история. Кнопки зависели от состояния, заезда и неявки не было вовсе,
// а история пряталась в серой полоске-разделителе.
describe("GazeboBookingDetailCard — статус и история", () => {
  // Время брони считаем от «сейчас», а не хардкодим датой: иначе тест про
  // недоступный чек-ин молча протухнет, когда эта дата наступит.
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const future = {
    startTime: tomorrow.toISOString(),
    endTime: new Date(tomorrow.getTime() + 2 * 60 * 60 * 1000).toISOString(),
  };

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("показывает выпадающий список со всеми статусами и с ОПЛАЧЕНО", () => {
    renderCard(future);

    const select = screen.getByLabelText("Статус брони") as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent ?? "");

    for (const expected of ["Ожидает", "Подтверждена", "Заезд", "Неявка", "Завершена", "Отменена"]) {
      expect(labels.some((l) => l.startsWith(expected))).toBe(true);
    }
    expect(labels.some((l) => l.includes("ОПЛАЧЕНО"))).toBe(true);
    expect(select.value).toBe("CONFIRMED");
  });

  it("недоступный переход виден, но заблокирован и подписан причиной", () => {
    renderCard(future);

    const select = screen.getByLabelText("Статус брони") as HTMLSelectElement;
    const checkIn = Array.from(select.options).find((o) => o.value === "CHECKED_IN")!;

    expect(checkIn.disabled).toBe(true);
    expect(checkIn.textContent).toContain("после начала");
  });

  it("выбор ОПЛАЧЕНО открывает ввод суммы, а не меняет статус", async () => {
    renderCard(future);

    fireEvent.change(screen.getByLabelText("Статус брони"), { target: { value: "__PAID__" } });

    expect(await screen.findByText("Отметить оплату")).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("записанная оплата уходит на отдельный эндпоинт, не трогая статус", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ success: true, data: { id: "booking-1", status: "CONFIRMED" } })
    );

    const { onStatusChanged } = renderCard(future);
    fireEvent.change(screen.getByLabelText("Статус брони"), { target: { value: "__PAID__" } });
    await screen.findByText("Отметить оплату");

    fireEvent.click(screen.getByText("Записать оплату"));

    await waitFor(() => expect(onStatusChanged).toHaveBeenCalled());
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/gazebos/bookings/booking-1/payment");
    expect((options as RequestInit).method).toBe("POST");
    expect(JSON.parse((options as RequestInit).body as string)).toMatchObject({
      cashAmount: 3000,
      cardAmount: 0,
    });
  });

  it("выбор «Отменить» из списка ведёт через то же подтверждение", async () => {
    renderCard(future);

    fireEvent.change(screen.getByLabelText("Статус брони"), { target: { value: "CANCELLED" } });

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("история открывается кнопкой и подтягивает события", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          events: [
            { id: "e1", action: "booking.create", label: "Бронь создана", actor: "Гость", at: "2026-08-01T10:00:00.000Z", details: [] },
          ],
          status: "CONFIRMED",
          restore: { available: false, hoursLeft: 0, reasonUnavailable: "Бронь не закрыта" },
        },
      })
    );

    renderCard(future);
    expect(screen.queryByText("Бронь создана")).toBeNull();

    fireEvent.click(screen.getByText("История"));

    expect(await screen.findByText("Бронь создана")).toBeTruthy();
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/gazebos/bookings/booking-1/history");
  });
});
