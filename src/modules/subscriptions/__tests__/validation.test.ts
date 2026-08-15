import { describe, it, expect } from "vitest";
import {
  createSubscriptionSchema,
  updateSubscriptionSchema,
  adjustHoursSchema,
  cancelSubscriptionSchema,
  listSubscriptionsSchema,
} from "@/modules/subscriptions/validation";

const validCreate = {
  userId: "user-1",
  totalHours: 5,
  pricePaid: 2500,
  validFrom: "2026-06-01",
  validTo: "2026-09-01",
};

describe("createSubscriptionSchema", () => {
  it("принимает валидный ввод и по умолчанию ставит paymentMethod=manual", () => {
    const result = createSubscriptionSchema.safeParse(validCreate);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.paymentMethod).toBe("manual");
    }
  });

  it("принимает paymentMethod=online явно", () => {
    const result = createSubscriptionSchema.safeParse({ ...validCreate, paymentMethod: "online" });
    expect(result.success).toBe(true);
  });

  it("отклоняет пустой userId", () => {
    const result = createSubscriptionSchema.safeParse({ ...validCreate, userId: "" });
    expect(result.success).toBe(false);
  });

  it("отклоняет totalHours <= 0", () => {
    const result = createSubscriptionSchema.safeParse({ ...validCreate, totalHours: 0 });
    expect(result.success).toBe(false);
  });

  it("отклоняет totalHours не кратный 0.25", () => {
    const result = createSubscriptionSchema.safeParse({ ...validCreate, totalHours: 5.1 });
    expect(result.success).toBe(false);
  });

  it("принимает totalHours кратный 0.25 (15 минут)", () => {
    const result = createSubscriptionSchema.safeParse({ ...validCreate, totalHours: 5.25 });
    expect(result.success).toBe(true);
  });

  it("отклоняет отрицательную pricePaid", () => {
    const result = createSubscriptionSchema.safeParse({ ...validCreate, pricePaid: -1 });
    expect(result.success).toBe(false);
  });

  it("принимает pricePaid = 0 (акция/бонус)", () => {
    const result = createSubscriptionSchema.safeParse({ ...validCreate, pricePaid: 0 });
    expect(result.success).toBe(true);
  });

  it("отклоняет validTo раньше validFrom", () => {
    const result = createSubscriptionSchema.safeParse({
      ...validCreate,
      validFrom: "2026-09-01",
      validTo: "2026-06-01",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["validTo"]);
    }
  });

  it("отклоняет равные validFrom/validTo (окно не может быть нулевым)", () => {
    const result = createSubscriptionSchema.safeParse({
      ...validCreate,
      validFrom: "2026-06-01",
      validTo: "2026-06-01",
    });
    expect(result.success).toBe(false);
  });

  it("принимает validFrom/validTo как ISO-дату с временем и офсетом", () => {
    const result = createSubscriptionSchema.safeParse({
      ...validCreate,
      validFrom: "2026-06-01T00:00:00+03:00",
      validTo: "2026-09-01T00:00:00+03:00",
    });
    expect(result.success).toBe(true);
  });

  it("отклоняет некорректный формат даты", () => {
    const result = createSubscriptionSchema.safeParse({ ...validCreate, validFrom: "01.06.2026" });
    expect(result.success).toBe(false);
  });

  it("отклоняет неизвестный paymentMethod", () => {
    const result = createSubscriptionSchema.safeParse({ ...validCreate, paymentMethod: "crypto" });
    expect(result.success).toBe(false);
  });

  it("notes опционален и допускает null", () => {
    expect(createSubscriptionSchema.safeParse({ ...validCreate, notes: null }).success).toBe(true);
    expect(createSubscriptionSchema.safeParse(validCreate).success).toBe(true);
  });

  it("отклоняет notes длиннее 2000 символов", () => {
    const result = createSubscriptionSchema.safeParse({ ...validCreate, notes: "x".repeat(2001) });
    expect(result.success).toBe(false);
  });
});

describe("updateSubscriptionSchema", () => {
  it("принимает пустой объект — оба поля опциональны", () => {
    expect(updateSubscriptionSchema.safeParse({}).success).toBe(true);
  });

  it("принимает только notes", () => {
    expect(updateSubscriptionSchema.safeParse({ notes: "уточнение" }).success).toBe(true);
  });

  it("принимает только pricePaid", () => {
    expect(updateSubscriptionSchema.safeParse({ pricePaid: 3000 }).success).toBe(true);
  });

  it("отклоняет отрицательную pricePaid", () => {
    expect(updateSubscriptionSchema.safeParse({ pricePaid: -1 }).success).toBe(false);
  });

  it("strict() — отклоняет неизвестные поля (нельзя тайком поменять totalHours/status мимо adjustHours)", () => {
    const result = updateSubscriptionSchema.safeParse({ notes: "ok", totalHours: 999 });
    expect(result.success).toBe(false);
  });
});

describe("adjustHoursSchema", () => {
  const valid = { type: "MANUAL_TOPUP" as const, hours: 2, reason: "Компенсация за сбой" };

  it("принимает валидное пополнение", () => {
    expect(adjustHoursSchema.safeParse(valid).success).toBe(true);
  });

  it("принимает валидное списание", () => {
    expect(adjustHoursSchema.safeParse({ ...valid, type: "MANUAL_DEDUCT" }).success).toBe(true);
  });

  it("отклоняет неизвестный type", () => {
    expect(adjustHoursSchema.safeParse({ ...valid, type: "AUTO" }).success).toBe(false);
  });

  it("отклоняет hours <= 0", () => {
    expect(adjustHoursSchema.safeParse({ ...valid, hours: 0 }).success).toBe(false);
    expect(adjustHoursSchema.safeParse({ ...valid, hours: -1 }).success).toBe(false);
  });

  it("отклоняет hours не кратный 0.25", () => {
    expect(adjustHoursSchema.safeParse({ ...valid, hours: 1.1 }).success).toBe(false);
  });

  it("отклоняет reason короче 3 символов", () => {
    expect(adjustHoursSchema.safeParse({ ...valid, reason: "ок" }).success).toBe(false);
  });

  it("обрезает пробелы в reason перед проверкой длины (trim)", () => {
    expect(adjustHoursSchema.safeParse({ ...valid, reason: "  ок  " }).success).toBe(false);
  });

  it("отклоняет reason длиннее 500 символов", () => {
    expect(adjustHoursSchema.safeParse({ ...valid, reason: "x".repeat(501) }).success).toBe(false);
  });

  it("требует reason — без него отклоняет", () => {
    const { reason: _reason, ...rest } = valid;
    expect(adjustHoursSchema.safeParse(rest).success).toBe(false);
  });
});

describe("cancelSubscriptionSchema", () => {
  it("принимает пустой объект — reason опционален", () => {
    expect(cancelSubscriptionSchema.safeParse({}).success).toBe(true);
  });

  it("принимает reason в пределах лимита", () => {
    expect(cancelSubscriptionSchema.safeParse({ reason: "Ошибка менеджера" }).success).toBe(true);
  });

  it("отклоняет reason длиннее 500 символов", () => {
    expect(cancelSubscriptionSchema.safeParse({ reason: "x".repeat(501) }).success).toBe(false);
  });
});

describe("listSubscriptionsSchema", () => {
  it("принимает пустой фильтр", () => {
    expect(listSubscriptionsSchema.safeParse({}).success).toBe(true);
  });

  it("принимает все валидные статусы", () => {
    for (const status of ["PENDING_PAYMENT", "ACTIVE", "EXPIRED", "DEPLETED", "CANCELLED"]) {
      expect(listSubscriptionsSchema.safeParse({ status }).success).toBe(true);
    }
  });

  it("отклоняет неизвестный статус", () => {
    expect(listSubscriptionsSchema.safeParse({ status: "REFUNDED" }).success).toBe(false);
  });

  it("коэрсит limit/offset из строк query-параметров", () => {
    const result = listSubscriptionsSchema.safeParse({ limit: "20", offset: "0" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
      expect(result.data.offset).toBe(0);
    }
  });

  it("отклоняет limit больше 200", () => {
    expect(listSubscriptionsSchema.safeParse({ limit: 201 }).success).toBe(false);
  });

  it("отклоняет отрицательный offset", () => {
    expect(listSubscriptionsSchema.safeParse({ offset: -1 }).success).toBe(false);
  });

  it("отклоняет search длиннее 200 символов", () => {
    expect(listSubscriptionsSchema.safeParse({ search: "x".repeat(201) }).success).toBe(false);
  });
});
