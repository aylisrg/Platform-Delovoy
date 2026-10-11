import { describe, it, expect, vi, afterEach } from "vitest";
import {
  adminBookingLink,
  formatClient,
  formatEventDate,
  formatRub,
  formatSlot,
  pluralDays,
} from "../text-format";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("formatEventDate", () => {
  it("ISO-дата → «сб, 10 октября»", () => {
    expect(formatEventDate("2026-10-10")).toBe("сб, 10 октября");
  });

  it("дата планировщика DD.MM.YYYY → тот же вид", () => {
    expect(formatEventDate("10.10.2026")).toBe("сб, 10 октября");
  });

  it("не сдвигает день из-за часового пояса (полночь UTC)", () => {
    expect(formatEventDate("2026-01-01")).toBe("чт, 1 января");
  });

  it("withYear — для договоров: «1 ноября 2026 г.»", () => {
    expect(formatEventDate("2026-11-01", { withYear: true })).toBe("1 ноября 2026 г.");
  });

  it("уже готовый текст и пустое значение возвращает как есть", () => {
    expect(formatEventDate("20 апреля 2026")).toBe("20 апреля 2026");
    expect(formatEventDate(undefined)).toBe("");
  });
});

describe("formatSlot", () => {
  it("дата и интервал времени одной строкой", () => {
    expect(formatSlot({ date: "2026-10-10", startTime: "16:00", endTime: "22:00" })).toBe(
      "сб, 10 октября · 16:00–22:00"
    );
  });

  it("без времени окончания — только начало", () => {
    expect(formatSlot({ date: "2026-10-10", startTime: "16:00" })).toBe("сб, 10 октября · 16:00");
  });
});

describe("formatClient", () => {
  it("имя и телефон через точку", () => {
    expect(formatClient({ clientName: "Иван", clientPhone: "+7900" })).toBe("Иван · +7900");
  });

  it("принимает устаревший userName", () => {
    expect(formatClient({ userName: "Мария" })).toBe("Мария");
  });

  it("пусто, если клиент неизвестен — строку «Клиент:» шаблон опускает", () => {
    expect(formatClient({})).toBe("");
  });
});

describe("formatRub", () => {
  it("разряды для числа и числовой строки", () => {
    expect(formatRub(50000)).toBe("50 000");
    expect(formatRub("1500.50")).toBe("1 500,5");
  });

  it("нечисловое значение — как есть", () => {
    expect(formatRub("12 000,00")).toBe("12 000,00");
    expect(formatRub(undefined)).toBe("");
  });
});

describe("pluralDays", () => {
  it.each([
    [1, "1 день"],
    [2, "2 дня"],
    [5, "5 дней"],
    [11, "11 дней"],
    [14, "14 дней"],
    [21, "21 день"],
    [22, "22 дня"],
  ])("%i → %s", (n, expected) => {
    expect(pluralDays(n)).toBe(expected);
  });
});

describe("adminBookingLink", () => {
  it("беседки → страница брони, ps-park → сессия", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://delovoy-park.ru");
    expect(adminBookingLink("gazebos", "b1")).toContain(
      '<a href="https://delovoy-park.ru/admin/gazebos/bookings/b1">'
    );
    expect(adminBookingLink("ps-park", "b1")).toContain("/admin/ps-park/sessions/b1");
  });

  it("без bookingId ссылки нет", () => {
    expect(adminBookingLink("gazebos", undefined)).toBe("");
  });
});
