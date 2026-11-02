// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DarkAvailabilityGrid } from "../dark-availability-grid";
import type { DayAvailability } from "@/modules/ps-park/types";

vi.mock("@/lib/metrika", () => ({ reachGoal: vi.fn() }));
vi.mock("@/lib/funnel-beacon", () => ({ sendFunnelBeacon: vi.fn() }));
const assign = vi.fn();
const availability = [{
  resource: { id: "table-1", name: "Стол 1", pricePerHour: 500, capacity: 4 },
  slots: [{ startTime: "10:00", endTime: "11:00", isAvailable: true }],
}] as unknown as DayAvailability[];

function show(offer: { slug: string } | null = { slug: "test-v1" }) {
  render(<DarkAvailabilityGrid initialAvailability={availability} initialDate="2030-01-10" offer={offer} />);
  fireEvent.click(screen.getByRole("button", { name: "10:00" }));
}
function fill() {
  fireEvent.change(screen.getByLabelText("Имя"), { target: { value: "Гость" } });
  fireEvent.change(screen.getByLabelText("Телефон"), { target: { value: "+79991234567" } });
  fireEvent.change(screen.getByLabelText("Email для чека"), { target: { value: "guest@example.test" } });
  fireEvent.click(screen.getByRole("checkbox"));
}
function response(body: unknown) {
  return { json: async () => body } as Response;
}
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  const original = window;
  vi.stubGlobal("window", new Proxy(original, {
    get(target, property) {
      return property === "location" ? { assign } : Reflect.get(target, property, target);
    },
  }));
  assign.mockClear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Публичный Play Park — сразу к оплате", () => {
  it("гость заполняет минимальные данные и переходит на оплату без входа и заявки менеджеру", async () => {
    vi.mocked(fetch).mockResolvedValue(response({ success: true, data: { payment: { confirmationUrl: "https://example.test/pay" } } }));
    show(); fill();
    fireEvent.click(screen.getByRole("button", { name: "Оплатить" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://example.test/pay"));
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/ps-park/book");
    const payload = JSON.parse(String(options?.body));
    expect(payload).toMatchObject({ resourceId: "table-1", startTime: "10:00", endTime: "11:00", acceptOffer: true, offerVersionSlug: "test-v1" });
    expect(payload.requestId).toMatch(/^[a-f0-9-]{36}$/);
    expect(payload.amount).toBeUndefined();
    expect(screen.queryByText(/Ожидайте подтверждения от менеджера/)).toBeNull();
  });

  it("без согласия не создаёт бронь", () => {
    show();
    expect((screen.getByRole("button", { name: "Оплатить" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(screen.getByRole("button", { name: "Оплатить" }).closest("form")!);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("без опубликованных условий не предлагает оплату", () => {
    show(null);
    expect(screen.getByText("Онлайн-бронирование временно недоступно.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Оплатить" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("два submit до ответа выполняют один запрос", async () => {
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    show(); fill();
    const form = screen.getByRole("button", { name: "Оплатить" }).closest("form")!;
    fireEvent.submit(form); fireEvent.submit(form);
    expect(fetch).toHaveBeenCalledTimes(1);
    finish(response({ success: false, error: { code: "PAYMENT_CREATE_PENDING", message: "Повторите" } }));
    await screen.findByText("Повторите");
  });

  it("после ошибки сети повторяет requestId и не показывает ложное подтверждение", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
    show(); fill();
    fireEvent.click(screen.getByRole("button", { name: "Оплатить" }));
    await screen.findByText("Не удалось отправить бронирование");
    vi.mocked(fetch).mockResolvedValue(response({ success: false, error: { message: "Оплата ещё не готова" } }));
    fireEvent.click(screen.getByRole("button", { name: "Оплатить" }));
    await screen.findByText("Оплата ещё не готова");
    const ids = vi.mocked(fetch).mock.calls.map(([, options]) => JSON.parse(String(options?.body)).requestId);
    expect(ids[0]).toBe(ids[1]);
    expect(assign).not.toHaveBeenCalled();
  });

  it("после окончательной отмены даёт новую попытку, а не повтор отменённого платежа", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ success: false, error: { code: "PAYMENT_CANCELED", message: "Отменено" } }));
    show(); fill();
    fireEvent.click(screen.getByRole("button", { name: "Оплатить" }));
    await screen.findByText("Отменено");
    vi.mocked(fetch).mockResolvedValue(response({ success: false, error: { message: "Новая попытка" } }));
    fireEvent.click(screen.getByRole("button", { name: "Оплатить" }));
    await screen.findByText("Новая попытка");
    const ids = vi.mocked(fetch).mock.calls.map(([, options]) => JSON.parse(String(options?.body)).requestId);
    expect(ids[0]).not.toBe(ids[1]);
  });
});
