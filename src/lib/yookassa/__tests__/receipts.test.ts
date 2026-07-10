import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildReceipt, receiptsEnabled, ReceiptContactError } from "../receipts";
import { toAmountValue } from "../client";
import { isYooKassaIp } from "../webhook-ips";

beforeEach(() => {
  delete process.env.YOOKASSA_RECEIPTS_ENABLED;
  delete process.env.YOOKASSA_VAT_CODE;
});

afterEach(() => {
  delete process.env.YOOKASSA_RECEIPTS_ENABLED;
  delete process.env.YOOKASSA_VAT_CODE;
});

describe("buildReceipt (54-ФЗ)", () => {
  it("выключенная фискализация → undefined (receipt не отправляется)", () => {
    expect(receiptsEnabled()).toBe(false);
    expect(buildReceipt({ email: "a@b.ru" }, [{ description: "Тест", amount: 100 }])).toBeUndefined();
  });

  it("включённая фискализация без контакта → ReceiptContactError", () => {
    process.env.YOOKASSA_RECEIPTS_ENABLED = "true";
    expect(() => buildReceipt({}, [{ description: "Тест", amount: 100 }])).toThrow(
      ReceiptContactError
    );
  });

  it("собирает чек: нормализация телефона 8→7, vat_code из env, суммы строками", () => {
    process.env.YOOKASSA_RECEIPTS_ENABLED = "true";
    process.env.YOOKASSA_VAT_CODE = "2";
    const receipt = buildReceipt({ phone: "8 (916) 123-45-67" }, [
      { description: "Аренда беседки", amount: 1500, paymentMode: "full_prepayment" },
    ]);
    expect(receipt).toEqual({
      customer: { phone: "79161234567" },
      items: [
        {
          description: "Аренда беседки",
          quantity: "1.00",
          amount: { value: "1500.00", currency: "RUB" },
          vat_code: 2,
          payment_subject: "service",
          payment_mode: "full_prepayment",
        },
      ],
    });
  });

  it("обрезает описание позиции до 128 символов", () => {
    process.env.YOOKASSA_RECEIPTS_ENABLED = "true";
    const receipt = buildReceipt({ email: "a@b.ru" }, [
      { description: "х".repeat(200), amount: 10 },
    ]);
    expect(receipt?.items[0].description).toHaveLength(128);
  });
});

describe("toAmountValue", () => {
  it("форматирует суммы в строку с двумя знаками", () => {
    expect(toAmountValue(1500)).toBe("1500.00");
    expect(toAmountValue("99.9")).toBe("99.90");
    expect(toAmountValue(0.1 + 0.2)).toBe("0.30");
  });

  it("бросает на отрицательных и нечисловых значениях", () => {
    expect(() => toAmountValue(-1)).toThrow();
    expect(() => toAmountValue("abc")).toThrow();
  });
});

describe("isYooKassaIp", () => {
  it("узнаёт официальные диапазоны ЮKassa", () => {
    expect(isYooKassaIp("185.71.76.5")).toBe(true);
    expect(isYooKassaIp("185.71.77.30")).toBe(true);
    expect(isYooKassaIp("77.75.153.100")).toBe(true);
    expect(isYooKassaIp("77.75.156.11")).toBe(true);
    expect(isYooKassaIp("2a02:5180::abcd")).toBe(true);
  });

  it("отклоняет посторонние адреса", () => {
    expect(isYooKassaIp("8.8.8.8")).toBe(false);
    expect(isYooKassaIp("77.75.156.12")).toBe(false);
    expect(isYooKassaIp("185.71.78.1")).toBe(false);
    expect(isYooKassaIp("::1")).toBe(false);
    expect(isYooKassaIp("not-an-ip")).toBe(false);
  });
});
