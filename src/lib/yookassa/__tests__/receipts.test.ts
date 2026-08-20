import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  buildReceipt,
  receiptsEnabled,
  resolveVatCode,
  ReceiptContactError,
  ReceiptVatCodeError,
  VAT_CODES,
  DEFAULT_VAT_CODE,
} from "../receipts";
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

  it("paymentSubject: commodity проходит в payment_subject, дефолт — service", () => {
    process.env.YOOKASSA_RECEIPTS_ENABLED = "true";
    const receipt = buildReceipt({ email: "a@b.ru" }, [
      { description: "Круассан", amount: 180, quantity: 2, paymentSubject: "commodity" },
      { description: "Аренда беседки", amount: 1500 },
    ]);
    expect(receipt?.items[0].payment_subject).toBe("commodity");
    expect(receipt?.items[1].payment_subject).toBe("service");
  });

  it("обрезает описание позиции до 128 символов", () => {
    process.env.YOOKASSA_RECEIPTS_ENABLED = "true";
    const receipt = buildReceipt({ email: "a@b.ru" }, [
      { description: "х".repeat(200), amount: 10 },
    ]);
    expect(receipt?.items[0].description).toHaveLength(128);
  });
});

describe("ставка НДС (vat_code)", () => {
  it("НДС 5 % — это код 7, а код 5 — расчётная 10/110", () => {
    // Ловушка справочника ЮKassa: значение env — код, а не процент.
    expect(VAT_CODES.RATE_5).toBe(7);
    expect(VAT_CODES.RATE_10_110).toBe(5);
    expect(DEFAULT_VAT_CODE).toBe(VAT_CODES.RATE_5);
  });

  it("env не задан → дефолт 5 % (код 7)", () => {
    expect(resolveVatCode()).toBe(7);
  });

  it("пустая строка → дефолт (ops-env удаляет ключ при пустом значении)", () => {
    process.env.YOOKASSA_VAT_CODE = "   ";
    expect(resolveVatCode()).toBe(7);
  });

  it("валидный код из env проходит как есть", () => {
    process.env.YOOKASSA_VAT_CODE = "11";
    expect(resolveVatCode()).toBe(11);
  });

  it.each(["0", "13", "abc", "5%", "7.5", "-7", "Infinity"])(
    "невалидный код %s → ReceiptVatCodeError",
    (raw) => {
      process.env.YOOKASSA_VAT_CODE = raw;
      expect(() => resolveVatCode()).toThrow(ReceiptVatCodeError);
    }
  );

  it("невалидный env валит сборку чека, а не уходит молча в ЮKassa", () => {
    process.env.YOOKASSA_RECEIPTS_ENABLED = "true";
    process.env.YOOKASSA_VAT_CODE = "20"; // процент вместо кода
    expect(() => buildReceipt({ email: "a@b.ru" }, [{ description: "Тест", amount: 10 }])).toThrow(
      ReceiptVatCodeError
    );
  });

  it("выключенная фискализация → невалидный env платежи не ломает", () => {
    process.env.YOOKASSA_VAT_CODE = "999";
    expect(buildReceipt({ email: "a@b.ru" }, [{ description: "Тест", amount: 10 }])).toBeUndefined();
  });

  it("дефолт применяется ко всем позициям чека, включая товары кафе", () => {
    process.env.YOOKASSA_RECEIPTS_ENABLED = "true";
    const receipt = buildReceipt({ email: "a@b.ru" }, [
      { description: "Круассан", amount: 180, paymentSubject: "commodity" },
      { description: "Аренда беседки", amount: 1500 },
    ]);
    expect(receipt?.items.map((i) => i.vat_code)).toEqual([7, 7]);
  });

  it("vatCode позиции перебивает env (чек возврата повторяет ставку продажи)", () => {
    process.env.YOOKASSA_RECEIPTS_ENABLED = "true";
    process.env.YOOKASSA_VAT_CODE = "7";
    const receipt = buildReceipt({ email: "a@b.ru" }, [
      { description: "Возврат брони", amount: 1500, vatCode: VAT_CODES.NONE },
    ]);
    expect(receipt?.items[0].vat_code).toBe(1);
  });

  it("битый vatCode позиции (порча снапшота) → ReceiptVatCodeError", () => {
    process.env.YOOKASSA_RECEIPTS_ENABLED = "true";
    expect(() =>
      buildReceipt({ email: "a@b.ru" }, [
        { description: "Возврат", amount: 100, vatCode: 42 },
      ])
    ).toThrow(ReceiptVatCodeError);
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
