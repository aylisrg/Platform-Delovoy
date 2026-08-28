// @vitest-environment jsdom
//
// #523: minBookingHours was hardcoded to 4 in this component instead of
// coming from Module.config (via TimelineData → TimelineGrid → this popover).
// These tests pin that the popover actually uses the prop, not a constant.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GazeboQuickBookingPopover } from "../quick-booking-popover";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

function jsonResponse(body: unknown) {
  return { json: async () => body } as Response;
}

afterEach(() => {
  cleanup();
});

// Часы работы беседок — 11:00–22:00 (оферта, п. 3.4). Раньше попап предполагал
// 08:00–23:00 хардкодом; теперь границы приходят пропами из сетки.
function renderPopover(
  minBookingHours: number,
  overrides: Partial<React.ComponentProps<typeof GazeboQuickBookingPopover>> = {}
) {
  const { container } = render(
    <GazeboQuickBookingPopover
      resourceId="resource-1"
      resourceName="Беседка №1"
      date="2030-06-15"
      startTime="11:00"
      maxEndTime="22:00"
      pricePerHour={500}
      minBookingHours={minBookingHours}
      openHour={11}
      closeHour={22}
      onClose={vi.fn()}
      onCreated={vi.fn()}
      {...overrides}
    />
  );
  const timeInputs = container.querySelectorAll<HTMLInputElement>('input[type="time"]');
  return { startInput: timeInputs[0], endInput: timeInputs[1] };
}

describe("GazeboQuickBookingPopover minBookingHours", () => {
  it("defaults the end time to start + minBookingHours (2h), not a hardcoded 4h", () => {
    const { endInput } = renderPopover(2);
    expect(endInput.value).toBe("13:00");
  });

  it("defaults the end time to start + minBookingHours (1h) when configured to 1", () => {
    const { endInput } = renderPopover(1);
    expect(endInput.value).toBe("12:00");
  });

  it("sets the end input's min attribute to start + minBookingHours (6h)", () => {
    const { endInput } = renderPopover(6);
    expect(endInput.min).toBe("17:00");
  });
});

describe("GazeboQuickBookingPopover — комментарий и email (issue #665)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("отправляет заполненные комментарий и email в теле запроса", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, data: {} }));
    renderPopover(2);

    fireEvent.change(screen.getByPlaceholderText("Имя клиента *"), { target: { value: "Иван" } });
    fireEvent.change(screen.getByPlaceholderText("Телефон *"), { target: { value: "+79991234567" } });
    fireEvent.change(screen.getByPlaceholderText("Email (необязательно)"), {
      target: { value: "guest@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("Комментарий (необязательно)"), {
      target: { value: "Аллергия на орехи" },
    });
    fireEvent.click(screen.getByText("Забронировать"));

    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.email).toBe("guest@example.com");
    expect(body.comment).toBe("Аллергия на орехи");
  });

  it("не отправляет comment/email в теле запроса, когда поля пустые", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, data: {} }));
    renderPopover(2);

    fireEvent.change(screen.getByPlaceholderText("Имя клиента *"), { target: { value: "Иван" } });
    fireEvent.change(screen.getByPlaceholderText("Телефон *"), { target: { value: "+79991234567" } });
    fireEvent.click(screen.getByText("Забронировать"));

    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body).not.toHaveProperty("email");
    expect(body).not.toHaveProperty("comment");
  });
});

describe("GazeboQuickBookingPopover — автокомплит гостя по телефону (issue #666)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("показывает подсказки после ввода 3+ символов телефона (AC-1)", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ success: true, data: [{ name: "Иван Петров", phone: "+79991234567" }] })
    );
    renderPopover(2);

    fireEvent.focus(screen.getByPlaceholderText("Телефон *"));
    fireEvent.change(screen.getByPlaceholderText("Телефон *"), { target: { value: "999" } });

    await screen.findByText("Иван Петров", {}, { timeout: 1000 });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/gazebos/guests/search?phone=999"),
      expect.anything()
    );
  });

  it("не запрашивает подсказки при вводе короче 3 символов", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, data: [] }));
    renderPopover(2);

    fireEvent.change(screen.getByPlaceholderText("Телефон *"), { target: { value: "99" } });
    await new Promise((r) => setTimeout(r, 350));

    expect(fetch).not.toHaveBeenCalled();
  });

  it("выбор гостя подставляет имя и телефон, имя остаётся редактируемым (AC-2)", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ success: true, data: [{ name: "Иван Петров", phone: "+79991234567" }] })
    );
    renderPopover(2);

    fireEvent.focus(screen.getByPlaceholderText("Телефон *"));
    fireEvent.change(screen.getByPlaceholderText("Телефон *"), { target: { value: "999" } });
    const suggestion = await screen.findByText("Иван Петров", {}, { timeout: 1000 });
    fireEvent.mouseDown(suggestion);

    const nameInput = screen.getByPlaceholderText("Имя клиента *") as HTMLInputElement;
    const phoneInput = screen.getByPlaceholderText("Телефон *") as HTMLInputElement;
    expect(nameInput.value).toBe("Иван Петров");
    expect(phoneInput.value).toBe("+79991234567");

    fireEvent.change(nameInput, { target: { value: "Иван Петров (компания)" } });
    expect(nameInput.value).toBe("Иван Петров (компания)");
  });

  it("нет совпадений — форма ведёт себя как ручной ввод (AC-3)", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, data: [] }));
    renderPopover(2);

    fireEvent.focus(screen.getByPlaceholderText("Телефон *"));
    fireEvent.change(screen.getByPlaceholderText("Телефон *"), { target: { value: "999" } });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled(), { timeout: 1000 });

    expect(screen.queryByRole("list")).toBeNull();
    const phoneInput = screen.getByPlaceholderText("Телефон *") as HTMLInputElement;
    expect(phoneInput.value).toBe("999");
  });

  it("быстрый ввод отменяет промежуточные запросы — летит только один fetch, с последним значением", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, data: [] }));
    renderPopover(2);

    const phoneInput = screen.getByPlaceholderText("Телефон *");
    fireEvent.focus(phoneInput);
    // Три быстрых нажатия подряд, все до истечения 300мс debounce — каждое
    // само по себе достаточной длины (3+ символа), чтобы запланировать fetch,
    // если бы debounce/AbortController не отменяли предыдущий таймер/запрос.
    fireEvent.change(phoneInput, { target: { value: "999" } });
    fireEvent.change(phoneInput, { target: { value: "9991" } });
    fireEvent.change(phoneInput, { target: { value: "99912" } });

    await new Promise((r) => setTimeout(r, 350));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/gazebos/guests/search?phone=99912"),
      expect.anything()
    );
  });
});

// ===== Кнопка «Весь день» =====
//
// Инцидент: клиента, просившего беседку на весь день, записали на 6 часов —
// максимум длительности не дал больше, а хвост дня система продала другому.
// Кнопка делает намерение «весь день» выразимым в один клик.
describe("GazeboQuickBookingPopover — весь день", () => {
  const weekendPricing = {
    weekdayHour: 1400,
    weekdayDay: 13000,
    weekendHour: 2000,
    weekendDay: 16000,
    hourRate: 2000,
    dayRate: 16000,
    isWeekend: true,
  };

  it("показывает кнопку, когда клик пришёлся на первый слот свободного дня", () => {
    renderPopover(4);
    expect(screen.getByRole("button", { name: /Весь день/ })).toBeTruthy();
  });

  it("не показывает кнопку, когда до конца дня есть чужая бронь", () => {
    renderPopover(4, { maxEndTime: "18:00" });
    expect(screen.queryByRole("button", { name: /Весь день/ })).toBeNull();
  });

  it("клик по кнопке проставляет полный рабочий день", () => {
    const { startInput, endInput } = renderPopover(4);

    fireEvent.click(screen.getByRole("button", { name: /Весь день/ }));

    expect(startInput.value).toBe("11:00");
    expect(endInput.value).toBe("22:00");
  });

  it("берёт границы времени из часов работы, а не из хардкода 08:00/23:00", () => {
    const { startInput, endInput } = renderPopover(4);
    expect(startInput.min).toBe("11:00");
    expect(endInput.max).toBe("22:00");
  });

  it("считает цену дня по дневному тарифу", () => {
    // 11 ч × 2000 = 22000 по часам против дневного 16000.
    renderPopover(4, { pricing: weekendPricing });
    // \s, а не пробел: toLocaleString("ru-RU") разделяет разряды неразрывным пробелом.
    expect(screen.getByRole("button", { name: /Весь день.*16\s000\s₽/ })).toBeTruthy();
  });

  it("предлагает добрать день, когда оставшиеся часы бесплатны", () => {
    const { endInput } = renderPopover(4, { pricing: weekendPricing });

    // 9 ч × 2000 = 18000 → потолок 16000; весь день стоит те же 16000.
    fireEvent.change(endInput, { target: { value: "20:00" } });

    expect(screen.getByRole("button", { name: /Ещё 2 ч — бесплатно/ })).toBeTruthy();
  });

  it("молчит про добор, когда он платный", () => {
    const { endInput } = renderPopover(4, { pricing: weekendPricing });

    // 5 ч × 2000 = 10000 — взять весь день за 16000 дороже.
    fireEvent.change(endInput, { target: { value: "16:00" } });

    expect(screen.queryByRole("button", { name: /бесплатно/ })).toBeNull();
  });
});
