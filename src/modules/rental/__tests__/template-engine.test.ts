import { describe, it, expect } from "vitest";
import {
  ALLOWED_VARIABLES,
  extractPlaceholders,
  validateTemplate,
  renderTemplate,
  renderWithMissing,
  buildVariables,
  formatDateRu,
  formatMoney,
} from "@/modules/rental/template-engine";

describe("extractPlaceholders", () => {
  it("returns unique placeholders from a string", () => {
    expect(extractPlaceholders("hi {{name}}, {{name}} again, {{bye}}")).toEqual([
      "name",
      "bye",
    ]);
  });
  it("returns empty for strings without placeholders", () => {
    expect(extractPlaceholders("plain text")).toEqual([]);
  });
});

describe("validateTemplate", () => {
  it("accepts only whitelist variables", () => {
    const r = validateTemplate("Hi {{contactName}}", "Amount {{amount}}");
    expect(r.ok).toBe(true);
  });
  it("rejects unknown variable", () => {
    const r = validateTemplate("{{contactName}}", "{{unknownVar}}");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.invalid).toContain("unknownVar");
    }
  });
});

describe("renderTemplate", () => {
  it("substitutes placeholders", () => {
    expect(renderTemplate("Hi {{name}}, {{dueDate}}", { name: "Ivan", dueDate: "01.05" })).toBe(
      "Hi Ivan, 01.05"
    );
  });
  it("replaces missing placeholders with empty string", () => {
    expect(renderTemplate("{{foo}} {{bar}}", { foo: "X" })).toBe("X ");
  });
});

describe("renderWithMissing", () => {
  it("reports missing variables that are used but not provided", () => {
    const r = renderWithMissing(
      { subject: "Hi {{contactName}}", bodyHtml: "Pay {{amount}}", bodyText: null },
      { contactName: "Иван" }
    );
    expect(r.subject).toBe("Hi Иван");
    expect(r.html).toBe("Pay ");
    expect(r.missingVars).toContain("amount");
  });
});

describe("buildVariables", () => {
  it("formats payment data into strings", () => {
    const dueDate = new Date(Date.UTC(2026, 4, 1));
    const vars = buildVariables({
      contract: {
        id: "c1",
        tenantId: "t1",
        officeId: "o1",
        startDate: new Date("2026-01-01"),
        endDate: new Date("2027-01-01"),
        pricePerSqm: null,
        monthlyRate: "45000",
        currency: "RUB",
        newPricePerSqm: null,
        priceIncreaseDate: null,
        deposit: null,
        contractNumber: "A-1",
        status: "ACTIVE",
        documentUrl: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        tenant: {
          id: "t1",
          companyName: "ООО Икс",
          tenantType: "COMPANY",
          contactName: "Иван Иванов",
          phone: null,
          phonesExtra: null,
          email: null,
          emailsExtra: null,
          inn: null,
          legalAddress: null,
          needsLegalAddress: false,
          notes: null,
          isDeleted: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        office: {
          id: "o1",
          number: "301",
          floor: 3,
          building: 2,
          officeType: "OFFICE",
          area: "30",
          pricePerMonth: "45000",
          hasWetPoint: false,
          hasToilet: false,
          hasRoofAccess: false,
          status: "OCCUPIED",
          metadata: null,
          comment: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      } as never,
      payment: {
        id: "p1",
        contractId: "c1",
        periodYear: 2026,
        periodMonth: 5,
        dueDate,
        amount: "45000",
        currency: "RUB",
        paidAt: null,
        markedPaidById: null,
        firstReminderSentAt: null,
        dueDateReminderSentAt: null,
        escalatedAt: null,
        amountAdjustmentReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never,
      settings: { bankDetails: "Р/с 123", managerName: "Пётр", managerPhone: "+7..." },
      now: new Date(Date.UTC(2026, 4, 10)),
    });
    expect(vars.tenantName).toBe("ООО Икс");
    expect(vars.contactName).toBe("Иван Иванов");
    expect(vars.contractNumber).toBe("A-1");
    expect(vars.officeNumber).toBe("301");
    expect(vars.dueDate).toBe("01.05.2026");
    expect(vars.periodMonth).toBe("май");
    expect(vars.periodYear).toBe("2026");
    expect(vars.daysOverdue).toBe("9");
    expect(vars.bankDetails).toBe("Р/с 123");
  });
});

describe("formatters", () => {
  it("formats dates ru", () => {
    expect(formatDateRu(new Date(Date.UTC(2026, 0, 5)))).toBe("05.01.2026");
  });
  it("formats rub amount", () => {
    const out = formatMoney(1234.5);
    expect(out).toMatch(/1\s234,50/);
    expect(out).toContain("₽");
  });
});

describe("ALLOWED_VARIABLES", () => {
  it("contains the core set", () => {
    expect(ALLOWED_VARIABLES).toContain("amount");
    expect(ALLOWED_VARIABLES).toContain("dueDate");
    expect(ALLOWED_VARIABLES).toContain("bankDetails");
  });
});
