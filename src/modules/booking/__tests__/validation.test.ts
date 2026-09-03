import { describe, it, expect } from "vitest";
import { checkoutDiscountSchema, updateBookingStatusSchema, weekTimelineQuerySchema } from "../validation";

describe("checkoutDiscountSchema", () => {
  it("accepts valid discount with reason", () => {
    const result = checkoutDiscountSchema.safeParse({
      discountPercent: 10,
      discountReason: "permanent_client",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.discountPercent).toBe(10);
      expect(result.data.discountReason).toBe("permanent_client");
    }
  });

  it("accepts all valid reasons", () => {
    const reasons = ["permanent_client", "corporate", "promo", "compensation", "other"];
    for (const reason of reasons) {
      const result = checkoutDiscountSchema.safeParse({
        discountPercent: 5,
        discountReason: reason,
        ...(reason === "other" && { discountNote: "Тестовая причина" }),
      });
      expect(result.success).toBe(true);
    }
  });

  it("accepts discount with note for 'other' reason", () => {
    const result = checkoutDiscountSchema.safeParse({
      discountPercent: 15,
      discountReason: "other",
      discountNote: "Клиент помог с организацией мероприятия",
    });
    expect(result.success).toBe(true);
  });

  it("rejects 'other' reason without note", () => {
    const result = checkoutDiscountSchema.safeParse({
      discountPercent: 15,
      discountReason: "other",
    });
    expect(result.success).toBe(false);
  });

  it("rejects 'other' reason with note shorter than 5 chars", () => {
    const result = checkoutDiscountSchema.safeParse({
      discountPercent: 15,
      discountReason: "other",
      discountNote: "abc",
    });
    expect(result.success).toBe(false);
  });

  it("accepts 'other' with exactly 5 chars note", () => {
    const result = checkoutDiscountSchema.safeParse({
      discountPercent: 15,
      discountReason: "other",
      discountNote: "абвгд",
    });
    expect(result.success).toBe(true);
  });

  it("rejects discountPercent = 0", () => {
    const result = checkoutDiscountSchema.safeParse({
      discountPercent: 0,
      discountReason: "promo",
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative discountPercent", () => {
    const result = checkoutDiscountSchema.safeParse({
      discountPercent: -5,
      discountReason: "promo",
    });
    expect(result.success).toBe(false);
  });

  it("rejects discountPercent > 100", () => {
    const result = checkoutDiscountSchema.safeParse({
      discountPercent: 150,
      discountReason: "promo",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer discountPercent", () => {
    const result = checkoutDiscountSchema.safeParse({
      discountPercent: 10.5,
      discountReason: "promo",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid discount reason", () => {
    const result = checkoutDiscountSchema.safeParse({
      discountPercent: 10,
      discountReason: "invalid_reason",
    });
    expect(result.success).toBe(false);
  });

  it("rejects note longer than 500 chars", () => {
    const result = checkoutDiscountSchema.safeParse({
      discountPercent: 10,
      discountReason: "other",
      discountNote: "a".repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it("accepts note at exactly 500 chars", () => {
    const result = checkoutDiscountSchema.safeParse({
      discountPercent: 10,
      discountReason: "other",
      discountNote: "a".repeat(500),
    });
    expect(result.success).toBe(true);
  });

  it("does not require note for non-other reasons", () => {
    const result = checkoutDiscountSchema.safeParse({
      discountPercent: 10,
      discountReason: "permanent_client",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.discountNote).toBeUndefined();
    }
  });
});

describe("updateBookingStatusSchema (#432)", () => {
  it("принимает корректную кассовую разбивку", () => {
    const result = updateBookingStatusSchema.safeParse({
      status: "COMPLETED",
      cashAmount: 600,
      cardAmount: 400,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cashAmount).toBe(600);
      expect(result.data.cardAmount).toBe(400);
    }
  });

  // Пара 2000 нал / −1000 карта при счёте 1000 сходилась по сумме и проезжала
  // гейт PAYMENT_REQUIRED, оставляя в FinancialTransaction отрицательную карту.
  it.each([
    ["cashAmount", { status: "COMPLETED", cashAmount: -1, cardAmount: 0 }],
    ["cardAmount", { status: "COMPLETED", cashAmount: 2000, cardAmount: -1000 }],
  ])("отклоняет отрицательный %s", (_field, body) => {
    expect(updateBookingStatusSchema.safeParse(body).success).toBe(false);
  });

  it("отклоняет суммы выше потолка и нечисловые", () => {
    // Потолок включительный: 10 000 000 проходит, 10 000 001 — уже нет.
    expect(
      updateBookingStatusSchema.safeParse({ status: "COMPLETED", cashAmount: 10_000_000 }).success
    ).toBe(true);
    expect(
      updateBookingStatusSchema.safeParse({ status: "COMPLETED", cashAmount: 10_000_001 }).success
    ).toBe(false);
    expect(
      updateBookingStatusSchema.safeParse({ status: "COMPLETED", cashAmount: "1000" }).success
    ).toBe(false);
  });

  it("принимает все статусы из enum BookingStatus и отклоняет посторонние", () => {
    for (const status of ["PENDING", "CONFIRMED", "CHECKED_IN", "COMPLETED", "CANCELLED", "NO_SHOW"]) {
      expect(updateBookingStatusSchema.safeParse({ status }).success).toBe(true);
    }
    for (const status of ["PAID", "completed", "", 42, null, undefined]) {
      expect(updateBookingStatusSchema.safeParse({ status }).success).toBe(false);
    }
  });

  it("ограничивает длину причины 500 символами", () => {
    expect(
      updateBookingStatusSchema.safeParse({ status: "CANCELLED", reason: "a".repeat(500) }).success
    ).toBe(true);
    expect(
      updateBookingStatusSchema.safeParse({ status: "CANCELLED", reason: "a".repeat(501) }).success
    ).toBe(false);
  });

  // null приходит от клиентов наравне с пропуском ключа — иначе завершение
  // брони падало бы в 422 на пустых полях формы.
  it("превращает null в undefined для сумм, причины и абонемента", () => {
    const result = updateBookingStatusSchema.safeParse({
      status: "CONFIRMED",
      cashAmount: null,
      cardAmount: null,
      reason: null,
      subscriptionId: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cashAmount).toBeUndefined();
      expect(result.data.cardAmount).toBeUndefined();
      expect(result.data.reason).toBeUndefined();
      expect(result.data.subscriptionId).toBeUndefined();
    }
  });

  it("считает пустой subscriptionId отсутствием абонемента", () => {
    const result = updateBookingStatusSchema.safeParse({
      status: "COMPLETED",
      subscriptionId: "",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.subscriptionId).toBeUndefined();
  });

  it("отбрасывает неизвестные ключи вместо падения", () => {
    const result = updateBookingStatusSchema.safeParse({
      status: "COMPLETED",
      discountPercent: 10,
      discountReason: "promo",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("discountPercent" in result.data).toBe(false);
    }
  });
});

describe("weekTimelineQuerySchema (issue #740)", () => {
  it("принимает дату YYYY-MM-DD — и не обязательно понедельник (нормализует сервер)", () => {
    expect(weekTimelineQuerySchema.safeParse({ weekStart: "2030-06-19" }).success).toBe(true);
  });

  it.each(["", "19.06.2030", "2030-6-1", "2030-06-19T00:00:00Z"])("отклоняет формат %j с русским сообщением", (weekStart) => {
    const res = weekTimelineQuerySchema.safeParse({ weekStart });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues[0].message).toBe("Формат даты: YYYY-MM-DD");
  });

  it("не принимает параметры диапазона — окно всегда 7 дней (ADR §7.1)", () => {
    const res = weekTimelineQuerySchema.safeParse({ weekStart: "2030-06-17", dateTo: "2031-01-01" });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data).toEqual({ weekStart: "2030-06-17" });
  });
});
