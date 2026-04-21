import { describe, it, expect } from "vitest";
import {
  createEmailTemplateSchema,
  updateEmailTemplateSchema,
  updateRentalSettingsSchema,
  sendEmailSchema,
  updatePaymentSchema,
  updateTaskSchema,
  isSystemTemplateKey,
} from "@/modules/rental/validation";

describe("createEmailTemplateSchema", () => {
  it("accepts valid user template", () => {
    const r = createEmailTemplateSchema.safeParse({
      key: "rental.custom",
      name: "My template",
      subject: "Hello {{contactName}}",
      bodyHtml: "<p>Pay {{amount}}</p>",
      variables: ["contactName", "amount"],
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown placeholder", () => {
    const r = createEmailTemplateSchema.safeParse({
      key: "rental.custom",
      name: "n",
      subject: "Hi {{foo}}",
      bodyHtml: "<p>{{contactName}}</p>",
    });
    expect(r.success).toBe(false);
  });

  it("rejects system-reserved key", () => {
    const r = createEmailTemplateSchema.safeParse({
      key: "rental.payment_reminder_pre",
      name: "n",
      subject: "Hi",
      bodyHtml: "<p>Hi</p>",
    });
    expect(r.success).toBe(false);
  });

  it("rejects key not matching rental.* pattern", () => {
    const r = createEmailTemplateSchema.safeParse({
      key: "custom",
      name: "n",
      subject: "Hi",
      bodyHtml: "<p>Hi</p>",
    });
    expect(r.success).toBe(false);
  });
});

describe("updateEmailTemplateSchema", () => {
  it("rejects when body has unknown placeholder", () => {
    const r = updateEmailTemplateSchema.safeParse({
      bodyHtml: "<p>{{foo}}</p>",
    });
    expect(r.success).toBe(false);
  });
  it("accepts partial valid update", () => {
    const r = updateEmailTemplateSchema.safeParse({ isActive: false });
    expect(r.success).toBe(true);
  });
});

describe("updateRentalSettingsSchema", () => {
  it("rejects preReminderDays 0", () => {
    const r = updateRentalSettingsSchema.safeParse({ preReminderDays: 0 });
    expect(r.success).toBe(false);
  });
  it("rejects preReminderDays 31", () => {
    const r = updateRentalSettingsSchema.safeParse({ preReminderDays: 31 });
    expect(r.success).toBe(false);
  });
  it("accepts valid fields", () => {
    const r = updateRentalSettingsSchema.safeParse({
      preReminderDays: 3,
      escalationDaysAfter: 7,
      autoSendEnabled: true,
    });
    expect(r.success).toBe(true);
  });
});

describe("sendEmailSchema", () => {
  it("rejects without tenantId and contractId", () => {
    const r = sendEmailSchema.safeParse({
      to: ["a@x.ru"],
      customSubject: "h",
      customBodyHtml: "<p>h</p>",
    });
    expect(r.success).toBe(false);
  });
  it("rejects without template or custom content", () => {
    const r = sendEmailSchema.safeParse({
      tenantId: "t1",
      to: ["a@x.ru"],
    });
    expect(r.success).toBe(false);
  });
  it("accepts template key only", () => {
    const r = sendEmailSchema.safeParse({
      tenantId: "t1",
      to: ["a@x.ru"],
      templateKey: "rental.manual",
    });
    expect(r.success).toBe(true);
  });
  it("rejects invalid email in to", () => {
    const r = sendEmailSchema.safeParse({
      tenantId: "t1",
      to: ["not-an-email"],
      templateKey: "rental.manual",
    });
    expect(r.success).toBe(false);
  });
});

describe("updatePaymentSchema", () => {
  it("requires reason when amount changes", () => {
    const r = updatePaymentSchema.safeParse({ amount: 10000 });
    expect(r.success).toBe(false);
  });
  it("accepts amount with reason", () => {
    const r = updatePaymentSchema.safeParse({
      amount: 10000,
      amountAdjustmentReason: "Доп. договор",
    });
    expect(r.success).toBe(true);
  });
  it("accepts paidAt=null", () => {
    const r = updatePaymentSchema.safeParse({ paidAt: null });
    expect(r.success).toBe(true);
  });
});

describe("updateTaskSchema", () => {
  it("requires deferUntil when DEFERRED", () => {
    const r = updateTaskSchema.safeParse({ status: "DEFERRED" });
    expect(r.success).toBe(false);
  });
  it("accepts RESOLVED without deferUntil", () => {
    const r = updateTaskSchema.safeParse({ status: "RESOLVED" });
    expect(r.success).toBe(true);
  });
});

describe("isSystemTemplateKey", () => {
  it("detects system keys", () => {
    expect(isSystemTemplateKey("rental.payment_reminder_pre")).toBe(true);
    expect(isSystemTemplateKey("rental.manual")).toBe(true);
  });
  it("returns false for custom keys", () => {
    expect(isSystemTemplateKey("rental.custom")).toBe(false);
  });
});
