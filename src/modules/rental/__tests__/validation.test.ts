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
  tenantFilterSchema,
  renewContractSchema,
  reportQuerySchema,
  revenueReportSchema,
  expiringReportSchema,
  createInquirySchema,
} from "@/modules/rental/validation";

// === Office Schemas ===

describe("createOfficeSchema", () => {
  it("accepts valid office input with all new fields", () => {
    const result = createOfficeSchema.safeParse({
      number: "33а",
      floor: 2,
      building: 3,
      officeType: "OFFICE",
      area: 15.1,
      pricePerMonth: 19026,
      hasWetPoint: true,
      hasToilet: false,
      hasRoofAccess: false,
      comment: "игровой центр",
    });
    expect(result.success).toBe(true);
  });

  it("accepts office with metadata", () => {
    const result = createOfficeSchema.safeParse({
      number: "A-12",
      floor: 1,
      building: 1,
      area: 25.5,
      pricePerMonth: 15000,
      metadata: { hasWindow: true },
    });
    expect(result.success).toBe(true);
  });

  it("requires building field", () => {
    const result = createOfficeSchema.safeParse({
      number: "301",
      floor: 3,
      area: 50,
      pricePerMonth: 30000,
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty number", () => {
    const result = createOfficeSchema.safeParse({
      number: "",
      floor: 3,
      building: 1,
      area: 50,
      pricePerMonth: 30000,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative floor", () => {
    const result = createOfficeSchema.safeParse({
      number: "301",
      floor: -1,
      building: 1,
      area: 50,
      pricePerMonth: 30000,
    });
    expect(result.success).toBe(false);
  });

  it("rejects zero area", () => {
    const result = createOfficeSchema.safeParse({
      number: "301",
      floor: 3,
      building: 1,
      area: 0,
      pricePerMonth: 30000,
    });
    expect(result.success).toBe(false);
  });

  it("accepts zero pricePerMonth", () => {
    const result = createOfficeSchema.safeParse({
      number: "301",
      floor: 3,
      building: 1,
      area: 50,
      pricePerMonth: 0,
    });
    expect(result.success).toBe(true);
  });

  it("rejects negative price", () => {
    const result = createOfficeSchema.safeParse({
      number: "301",
      floor: 3,
      building: 1,
      area: 50,
      pricePerMonth: -100,
    });
    expect(result.success).toBe(false);
  });

  it("accepts CONTAINER office type", () => {
    const result = createOfficeSchema.safeParse({
      number: "9",
      floor: 1,
      building: 1,
      officeType: "CONTAINER",
      area: 7.1,
      pricePerMonth: 0,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid office type", () => {
    const result = createOfficeSchema.safeParse({
      number: "301",
      floor: 3,
      building: 1,
      officeType: "GARAGE",
      area: 50,
      pricePerMonth: 30000,
    });
    expect(result.success).toBe(false);
  });
});

describe("updateOfficeSchema", () => {
  it("accepts partial update", () => {
    const result = updateOfficeSchema.safeParse({ pricePerMonth: 35000 });
    expect(result.success).toBe(true);
  });

  it("accepts status update including RESERVED", () => {
    const result = updateOfficeSchema.safeParse({ status: "RESERVED" });
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
  it("accepts valid tenant input with new fields", () => {
    const result = createTenantSchema.safeParse({
      companyName: "ООО «МК ОРИОН-СЕРВИС»",
      tenantType: "COMPANY",
      contactName: "Павел",
      phone: "79168469325",
      phonesExtra: ["79262674164"],
      email: "il85@list.ru",
      emailsExtra: ["moroz891@mail.ru"],
      inn: "7727563401",
      legalAddress: "г. Москва, ул. Тестовая, д.1",
      needsLegalAddress: true,
      notes: "договор в Росреестре",
    });
    expect(result.success).toBe(true);
  });

  it("accepts tenant with only companyName", () => {
    const result = createTenantSchema.safeParse({
      companyName: "ИП Петров",
    });
    expect(result.success).toBe(true);
  });

  it("accepts 12-digit INN for IP", () => {
    const result = createTenantSchema.safeParse({
      companyName: "ИП Сидоров С.С.",
      tenantType: "IP",
      inn: "123456789012",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty company name", () => {
    const result = createTenantSchema.safeParse({
      companyName: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid email", () => {
    const result = createTenantSchema.safeParse({
      companyName: "ООО Тест",
      email: "not-an-email",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid INN (wrong length)", () => {
    const result = createTenantSchema.safeParse({
      companyName: "ООО Тест",
      inn: "123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-numeric INN", () => {
    const result = createTenantSchema.safeParse({
      companyName: "ООО Тест",
      inn: "123456789a",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid email in emailsExtra", () => {
    const result = createTenantSchema.safeParse({
      companyName: "ООО Тест",
      emailsExtra: ["bad-email"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid tenantType", () => {
    const result = createTenantSchema.safeParse({
      companyName: "Тест",
      tenantType: "LLC",
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

describe("tenantFilterSchema", () => {
  it("accepts valid filter with search and type", () => {
    const result = tenantFilterSchema.safeParse({ search: "Орион", type: "COMPANY", page: 1, limit: 20 });
    expect(result.success).toBe(true);
  });

  it("provides default page and limit", () => {
    const result = tenantFilterSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(20);
    }
  });

  it("rejects limit over 50", () => {
    const result = tenantFilterSchema.safeParse({ limit: 100 });
    expect(result.success).toBe(false);
  });
});

// === Contract Schemas ===

describe("createContractSchema", () => {
  it("accepts valid contract with new fields", () => {
    const result = createContractSchema.safeParse({
      tenantId: "tenant-1",
      officeId: "office-1",
      startDate: "2025-01-01",
      endDate: "2026-12-31",
      pricePerSqm: 1260,
      monthlyRate: 35532,
      currency: "RUB",
      contractNumber: "Д-2025/001",
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
});

describe("updateContractSchema", () => {
  it("accepts valid status update", () => {
    const result = updateContractSchema.safeParse({ status: "TERMINATED" });
    expect(result.success).toBe(true);
  });

  it("accepts newPricePerSqm and priceIncreaseDate", () => {
    const result = updateContractSchema.safeParse({
      newPricePerSqm: 1350,
      priceIncreaseDate: "2026-09-01",
    });
    expect(result.success).toBe(true);
  });

  it("accepts contractNumber update", () => {
    const result = updateContractSchema.safeParse({ contractNumber: "Д-2025/042" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid status", () => {
    const result = updateContractSchema.safeParse({ status: "INVALID" });
    expect(result.success).toBe(false);
  });

  it("rejects notes over 5000 chars", () => {
    const result = updateContractSchema.safeParse({ notes: "a".repeat(5001) });
    expect(result.success).toBe(false);
  });
});

describe("renewContractSchema", () => {
  it("accepts valid renew input", () => {
    const result = renewContractSchema.safeParse({ newEndDate: "2027-12-31" });
    expect(result.success).toBe(true);
  });

  it("accepts renew with new price", () => {
    const result = renewContractSchema.safeParse({
      newEndDate: "2027-12-31",
      newPricePerSqm: 1500,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid date format", () => {
    const result = renewContractSchema.safeParse({ newEndDate: "31-12-2027" });
    expect(result.success).toBe(false);
  });
});

// === Filter Schemas ===

describe("contractFilterSchema", () => {
  it("accepts valid filter", () => {
    const result = contractFilterSchema.safeParse({ status: "ACTIVE", tenantId: "t-1" });
    expect(result.success).toBe(true);
  });

  it("accepts array of statuses", () => {
    const result = contractFilterSchema.safeParse({ status: ["ACTIVE", "EXPIRING"] });
    expect(result.success).toBe(true);
  });

  it("accepts empty filter with default pagination", () => {
    const result = contractFilterSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(20);
    }
  });
});

describe("officeFilterSchema", () => {
  it("accepts valid filter with building", () => {
    const result = officeFilterSchema.safeParse({ status: "AVAILABLE", floor: 3, building: 2 });
    expect(result.success).toBe(true);
  });

  it("accepts filter by office type", () => {
    const result = officeFilterSchema.safeParse({ type: "CONTAINER" });
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
});

describe("revenueReportSchema", () => {
  it("accepts building filter", () => {
    const result = revenueReportSchema.safeParse({ building: "2" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.building).toBe(2);
    }
  });

  it("provides default period", () => {
    const result = revenueReportSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.period).toBe("month");
    }
  });
});

describe("expiringReportSchema", () => {
  it("accepts days parameter", () => {
    const result = expiringReportSchema.safeParse({ days: "60" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.days).toBe(60);
    }
  });

  it("provides default 30 days", () => {
    const result = expiringReportSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.days).toBe(30);
    }
  });
});

// === Inquiry Schema ===

describe("createInquirySchema", () => {
  it("accepts minimal valid inquiry", () => {
    const result = createInquirySchema.safeParse({
      name: "Иван",
      phone: "+7999123",
    });
    expect(result.success).toBe(true);
  });

  it("accepts inquiry with officeIds array", () => {
    const result = createInquirySchema.safeParse({
      name: "Иван",
      phone: "+7999123",
      officeIds: ["id1", "id2", "id3"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts inquiry with single officeId (backward compat)", () => {
    const result = createInquirySchema.safeParse({
      name: "Иван",
      phone: "+7999123",
      officeId: "id1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects officeIds with more than 10 items", () => {
    const result = createInquirySchema.safeParse({
      name: "Иван",
      phone: "+7999123",
      officeIds: Array.from({ length: 11 }, (_, i) => `id${i}`),
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = createInquirySchema.safeParse({
      name: "",
      phone: "+7999123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects too-short phone", () => {
    const result = createInquirySchema.safeParse({
      name: "Иван",
      phone: "12",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid email", () => {
    const result = createInquirySchema.safeParse({
      name: "Иван",
      phone: "+7999123",
      email: "not-an-email",
    });
    expect(result.success).toBe(false);
  });
});
