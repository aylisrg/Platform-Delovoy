import { describe, it, expect } from "vitest";
import {
  createOfficeSchema,
  updateOfficeSchema,
  createTenantSchema,
  updateTenantSchema,
  createContractSchema,
  updateContractSchema,
  contractFilterSchema,
  officeFilterSchema,
  reportQuerySchema,
} from "@/modules/rental/validation";

// === Office Schemas ===

describe("createOfficeSchema", () => {
  it("accepts valid office input", () => {
    const result = createOfficeSchema.safeParse({
      number: "301",
      floor: 3,
      area: 50,
      pricePerMonth: 30000,
    });
    expect(result.success).toBe(true);
  });

  it("accepts office with metadata", () => {
    const result = createOfficeSchema.safeParse({
      number: "A-12",
      floor: 1,
      area: 25.5,
      pricePerMonth: 15000,
      metadata: { hasWindow: true, renovation: "2024" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty number", () => {
    const result = createOfficeSchema.safeParse({
      number: "",
      floor: 3,
      area: 50,
      pricePerMonth: 30000,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative floor", () => {
    const result = createOfficeSchema.safeParse({
      number: "301",
      floor: -1,
      area: 50,
      pricePerMonth: 30000,
    });
    expect(result.success).toBe(false);
  });

  it("rejects zero area", () => {
    const result = createOfficeSchema.safeParse({
      number: "301",
      floor: 3,
      area: 0,
      pricePerMonth: 30000,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative price", () => {
    const result = createOfficeSchema.safeParse({
      number: "301",
      floor: 3,
      area: 50,
      pricePerMonth: -100,
    });
    expect(result.success).toBe(false);
  });
});

describe("updateOfficeSchema", () => {
  it("accepts partial update", () => {
    const result = updateOfficeSchema.safeParse({ pricePerMonth: 35000 });
    expect(result.success).toBe(true);
  });

  it("accepts status update", () => {
    const result = updateOfficeSchema.safeParse({ status: "MAINTENANCE" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid status", () => {
    const result = updateOfficeSchema.safeParse({ status: "INVALID" });
    expect(result.success).toBe(false);
  });

  it("accepts empty update", () => {
    const result = updateOfficeSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

// === Tenant Schemas ===

describe("createTenantSchema", () => {
  it("accepts valid tenant input", () => {
    const result = createTenantSchema.safeParse({
      companyName: "ООО Тест",
      contactName: "Иванов Иван",
      email: "test@test.ru",
      phone: "+79001234567",
      inn: "1234567890",
    });
    expect(result.success).toBe(true);
  });

  it("accepts tenant without optional fields", () => {
    const result = createTenantSchema.safeParse({
      companyName: "ИП Петров",
      contactName: "Петров Пётр",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty company name", () => {
    const result = createTenantSchema.safeParse({
      companyName: "",
      contactName: "Тест",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid email", () => {
    const result = createTenantSchema.safeParse({
      companyName: "ООО Тест",
      contactName: "Тест",
      email: "not-an-email",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid INN (wrong length)", () => {
    const result = createTenantSchema.safeParse({
      companyName: "ООО Тест",
      contactName: "Тест",
      inn: "123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-numeric INN", () => {
    const result = createTenantSchema.safeParse({
      companyName: "ООО Тест",
      contactName: "Тест",
      inn: "123456789a",
    });
    expect(result.success).toBe(false);
  });
});

describe("updateTenantSchema", () => {
  it("accepts partial update", () => {
    const result = updateTenantSchema.safeParse({ phone: "+79009876543" });
    expect(result.success).toBe(true);
  });

  it("accepts empty update", () => {
    const result = updateTenantSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

// === Contract Schemas ===

describe("createContractSchema", () => {
  it("accepts valid contract input", () => {
    const result = createContractSchema.safeParse({
      tenantId: "tenant-1",
      officeId: "office-1",
      startDate: "2025-01-01",
      endDate: "2026-12-31",
      monthlyRate: 30000,
      deposit: 60000,
    });
    expect(result.success).toBe(true);
  });

  it("accepts contract without optional fields", () => {
    const result = createContractSchema.safeParse({
      tenantId: "tenant-1",
      officeId: "office-1",
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      monthlyRate: 25000,
    });
    expect(result.success).toBe(true);
  });

  it("rejects if startDate >= endDate", () => {
    const result = createContractSchema.safeParse({
      tenantId: "tenant-1",
      officeId: "office-1",
      startDate: "2025-12-31",
      endDate: "2025-01-01",
      monthlyRate: 30000,
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid date format", () => {
    const result = createContractSchema.safeParse({
      tenantId: "tenant-1",
      officeId: "office-1",
      startDate: "01/01/2025",
      endDate: "12/31/2025",
      monthlyRate: 30000,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative monthly rate", () => {
    const result = createContractSchema.safeParse({
      tenantId: "tenant-1",
      officeId: "office-1",
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      monthlyRate: -100,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative deposit", () => {
    const result = createContractSchema.safeParse({
      tenantId: "tenant-1",
      officeId: "office-1",
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      monthlyRate: 30000,
      deposit: -1,
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid document URL", () => {
    const result = createContractSchema.safeParse({
      tenantId: "tenant-1",
      officeId: "office-1",
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      monthlyRate: 30000,
      documentUrl: "https://storage.example.com/contracts/doc.pdf",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid document URL", () => {
    const result = createContractSchema.safeParse({
      tenantId: "tenant-1",
      officeId: "office-1",
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      monthlyRate: 30000,
      documentUrl: "not-a-url",
    });
    expect(result.success).toBe(false);
  });
});

describe("updateContractSchema", () => {
  it("accepts valid status update", () => {
    const result = updateContractSchema.safeParse({ status: "TERMINATED" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid status", () => {
    const result = updateContractSchema.safeParse({ status: "INVALID" });
    expect(result.success).toBe(false);
  });

  it("accepts monthly rate update", () => {
    const result = updateContractSchema.safeParse({ monthlyRate: 35000 });
    expect(result.success).toBe(true);
  });

  it("accepts notes update", () => {
    const result = updateContractSchema.safeParse({ notes: "Продлён на год" });
    expect(result.success).toBe(true);
  });

  it("rejects notes over 2000 chars", () => {
    const result = updateContractSchema.safeParse({ notes: "a".repeat(2001) });
    expect(result.success).toBe(false);
  });
});

// === Filter Schemas ===

describe("contractFilterSchema", () => {
  it("accepts valid filter", () => {
    const result = contractFilterSchema.safeParse({ status: "ACTIVE", tenantId: "t-1" });
    expect(result.success).toBe(true);
  });

  it("accepts empty filter", () => {
    const result = contractFilterSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("officeFilterSchema", () => {
  it("accepts valid filter", () => {
    const result = officeFilterSchema.safeParse({ status: "AVAILABLE", floor: 3 });
    expect(result.success).toBe(true);
  });

  it("accepts empty filter", () => {
    const result = officeFilterSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("coerces floor string to number", () => {
    const result = officeFilterSchema.safeParse({ floor: "3" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.floor).toBe(3);
    }
  });
});

describe("reportQuerySchema", () => {
  it("accepts valid year and month", () => {
    const result = reportQuerySchema.safeParse({ year: 2025, month: 6 });
    expect(result.success).toBe(true);
  });

  it("coerces strings to numbers", () => {
    const result = reportQuerySchema.safeParse({ year: "2025", month: "6" });
    expect(result.success).toBe(true);
  });

  it("rejects month 0", () => {
    const result = reportQuerySchema.safeParse({ year: 2025, month: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects month 13", () => {
    const result = reportQuerySchema.safeParse({ year: 2025, month: 13 });
    expect(result.success).toBe(false);
  });

  it("rejects year below 2020", () => {
    const result = reportQuerySchema.safeParse({ year: 2019, month: 1 });
    expect(result.success).toBe(false);
  });
});
