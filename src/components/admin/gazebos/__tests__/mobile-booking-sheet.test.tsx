// @vitest-environment jsdom
//
// issue #665: quick-форма бронирования не давала указать комментарий/email —
// мобильная форма должна получить те же поля, что десктопная (паритет, AC-2).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GazeboMobileBookingSheet } from "../mobile-booking-sheet";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

function jsonResponse(body: unknown) {
  return { json: async () => body } as Response;
}

// Часы работы беседок — 11:00–22:00 (оферта, п. 3.4). Раньше лента предлагала
// 08:00–23:00 из дефолтов booking-time, взятых у Плей Парка.
function renderSheet(
  overrides: Partial<React.ComponentProps<typeof GazeboMobileBookingSheet>> = {}
) {
  return render(
    <GazeboMobileBookingSheet
      open
      onClose={vi.fn()}
      onCreated={vi.fn()}
      resourceId="resource-1"
      resourceName="Беседка №1"
      date="2030-06-15"
      startTime="11:00"
      maxEndTime="22:00"
      pricePerHour={500}
      minBookingHours={4}
      openTime="11:00"
      closeTime="22:00"
      {...overrides}
    />
  );
}

describe("GazeboMobileBookingSheet — комментарий и email (issue #665)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("отправляет заполненные комментарий и email в теле запроса", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, data: {} }));
    renderSheet();

    fireEvent.change(screen.getByPlaceholderText("Например, Иван"), { target: { value: "Иван" } });
    fireEvent.change(screen.getByPlaceholderText("guest@example.com"), {
      target: { value: "guest@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("Пожелания гостя, особые условия…"), {
      target: { value: "Аллергия на орехи" },
    });
    fireEvent.click(screen.getByText(/Забронировать/));

    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.email).toBe("guest@example.com");
    expect(body.comment).toBe("Аллергия на орехи");
  });

  it("не отправляет comment/email в теле запроса, когда поля пустые", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, data: {} }));
    renderSheet();

    fireEvent.change(screen.getByPlaceholderText("Например, Иван"), { target: { value: "Иван" } });
    fireEvent.click(screen.getByText(/Забронировать/));

    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body).not.toHaveProperty("email");
    expect(body).not.toHaveProperty("comment");
  });
});

describe("GazeboMobileBookingSheet — автокомплит гостя по телефону (issue #666)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("показывает подсказки после ввода 3+ символов телефона (AC-1, паритет с desktop)", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ success: true, data: [{ name: "Иван Петров", phone: "+79991234567" }] })
    );
    renderSheet();

    const phoneInput = screen.getByPlaceholderText("+7 ___ ___ __ __");
    fireEvent.focus(phoneInput);
    fireEvent.change(phoneInput, { target: { value: "999" } });

    await screen.findByText("Иван Петров", {}, { timeout: 1000 });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/gazebos/guests/search?phone=999"),
      expect.anything()
    );
  });

  it("выбор гостя подставляет имя и телефон", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ success: true, data: [{ name: "Иван Петров", phone: "+79991234567" }] })
    );
    renderSheet();

    const phoneInput = screen.getByPlaceholderText("+7 ___ ___ __ __") as HTMLInputElement;
    fireEvent.focus(phoneInput);
    fireEvent.change(phoneInput, { target: { value: "999" } });
    const suggestion = await screen.findByText("Иван Петров", {}, { timeout: 1000 });
    fireEvent.mouseDown(suggestion);

    const nameInput = screen.getByPlaceholderText("Например, Иван") as HTMLInputElement;
    expect(nameInput.value).toBe("Иван Петров");
    expect(phoneInput.value).toBe("+79991234567");
  });
});

// ===== Чип «Весь день» =====
//
// Мобильная админка — рабочий инструмент смены. До правки список длительностей
// был захардкожен [4ч…8ч], и выкупить беседку на весь день с телефона было
// нельзя вообще.
describe("GazeboMobileBookingSheet — весь день", () => {
  const weekendPricing = {
    weekdayHour: 1400,
    weekdayDay: 13000,
    weekendHour: 2000,
    weekendDay: 16000,
    hourRate: 2000,
    dayRate: 16000,
    isWeekend: true,
  };

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("показывает чип, когда тап пришёлся на первый слот свободного дня", () => {
    renderSheet();
    expect(screen.getByRole("button", { name: "Весь день" })).toBeTruthy();
  });

  it("не показывает чип, когда до конца дня есть чужая бронь", () => {
    renderSheet({ maxEndTime: "18:00" });
    expect(screen.queryByRole("button", { name: "Весь день" })).toBeNull();
  });

  it("отправляет endTime = концу рабочего дня", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, data: {} }));
    renderSheet();

    fireEvent.click(screen.getByRole("button", { name: "Весь день" }));
    fireEvent.change(screen.getByPlaceholderText("Например, Иван"), {
      target: { value: "Иван" },
    });
    fireEvent.click(screen.getByText(/Забронировать/));

    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.startTime).toBe("11:00");
    expect(body.endTime).toBe("22:00");
  });

  it("подпись «мин. N ч.» берётся из настроек, а не из хардкода", () => {
    renderSheet({ minBookingHours: 3 });
    expect(screen.getByText(/мин\. 3 ч\./)).toBeTruthy();
  });

  it("предлагает бесплатный добор, когда дневной тариф уже покрыл выбор", () => {
    renderSheet({ pricing: weekendPricing });

    // 8 ч × 2000 = 16000 ровно равны дневному тарифу — добор до 11 ч бесплатен.
    fireEvent.click(screen.getByRole("button", { name: "8ч" }));

    expect(screen.getByRole("button", { name: /Ещё 3 ч — бесплатно/ })).toBeTruthy();
  });

  it("молчит про добор, когда он платный", () => {
    renderSheet({ pricing: weekendPricing });

    fireEvent.click(screen.getByRole("button", { name: "5ч" }));

    expect(screen.queryByRole("button", { name: /бесплатно/ })).toBeNull();
  });
});
