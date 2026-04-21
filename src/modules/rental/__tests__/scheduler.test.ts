import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    rentalPayment: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    rentalNotificationSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    emailTemplate: {
      findUnique: vi.fn(),
    },
    emailLog: {
      create: vi.fn(),
    },
    managerTask: {
      create: vi.fn(),
    },
    systemEvent: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/modules/notifications/channels/email", () => ({
  sendTransactionalEmail: vi.fn(),
}));

vi.mock("@/lib/telegram-alert", () => ({
  sendTelegramAlert: vi.fn(),
}));

import { prisma } from "@/lib/db";
import { sendTransactionalEmail } from "@/modules/notifications/channels/email";
import { sendTelegramAlert } from "@/lib/telegram-alert";
import {
  sendPreReminders,
  sendDueReminders,
  escalateOverdue,
  runRentalPaymentReminders,
} from "@/modules/rental/scheduler";

type MockedPrisma = {
  rentalPayment: {
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  rentalNotificationSettings: {
    findUnique: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
  emailTemplate: { findUnique: ReturnType<typeof vi.fn> };
  emailLog: { create: ReturnType<typeof vi.fn> };
  managerTask: { create: ReturnType<typeof vi.fn> };
  systemEvent: { create: ReturnType<typeof vi.fn> };
};
const mockedPrisma = prisma as unknown as MockedPrisma;
const mockedSendEmail = sendTransactionalEmail as ReturnType<typeof vi.fn>;
const mockedSendTelegram = sendTelegramAlert as ReturnType<typeof vi.fn>;

const DEFAULT_SETTINGS = {
  id: "singleton",
  preReminderDays: 5,
  escalationDaysAfter: 5,
  autoSendEnabled: true,
  fromEmail: "buh@delovoy-park.ru",
  fromName: "Бухгалтерия",
  bankDetails: "Р/с",
  managerName: null,
  managerPhone: null,
  escalationTelegramEnabled: true,
  escalationTelegramChatId: "-100",
  updatedAt: new Date(),
  updatedById: null,
};

function makePayment(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    contractId: "c1",
    periodYear: 2026,
    periodMonth: 5,
    dueDate: new Date("2026-05-01"),
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
    contract: {
      id: "c1",
      tenantId: "t1",
      officeId: "o1",
      startDate: new Date(),
      endDate: new Date(),
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
        contactName: "Иван",
        phone: "+7",
        email: "test@example.com",
        emailsExtra: null,
        inn: null,
        notes: null,
        tenantType: "COMPANY",
        phonesExtra: null,
        legalAddress: null,
        needsLegalAddress: false,
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
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedPrisma.rentalNotificationSettings.findUnique.mockResolvedValue(DEFAULT_SETTINGS);
  mockedPrisma.rentalNotificationSettings.upsert.mockResolvedValue(DEFAULT_SETTINGS);
  mockedPrisma.emailTemplate.findUnique.mockResolvedValue({
    id: "t",
    key: "rental.payment_reminder_pre",
    name: "x",
    subject: "Sub {{amount}}",
    bodyHtml: "<p>{{contactName}} {{dueDate}}</p>",
    bodyText: null,
    variables: [],
    isActive: true,
    isSystem: true,
    moduleSlug: "rental",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  mockedPrisma.emailLog.create.mockResolvedValue({ id: "log1" });
  mockedPrisma.systemEvent.create.mockResolvedValue({ id: "ev1" });
  mockedSendEmail.mockResolvedValue({ success: true });
  mockedSendTelegram.mockResolvedValue(true);
});

describe("sendPreReminders", () => {
  it("sends email and marks firstReminderSentAt for each payment in window", async () => {
    mockedPrisma.rentalPayment.findMany.mockResolvedValue([makePayment()]);
    mockedPrisma.rentalPayment.update.mockResolvedValue({});
    const stats = await sendPreReminders(5, new Date("2026-04-26"));
    expect(stats.sent).toBe(1);
    expect(mockedSendEmail).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.rentalPayment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ firstReminderSentAt: expect.any(Date) }),
      })
    );
  });

  it("does not re-send when firstReminderSentAt is already set (findMany filter excludes them)", async () => {
    mockedPrisma.rentalPayment.findMany.mockResolvedValue([]);
    const stats = await sendPreReminders(5, new Date("2026-04-26"));
    expect(stats.scanned).toBe(0);
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });

  it("leaves flag unset if email fails", async () => {
    mockedPrisma.rentalPayment.findMany.mockResolvedValue([makePayment()]);
    mockedSendEmail.mockResolvedValue({ success: false, error: "smtp down" });
    mockedPrisma.rentalPayment.update.mockResolvedValue({});
    const stats = await sendPreReminders(5, new Date("2026-04-26"));
    expect(stats.sent).toBe(0);
    expect(mockedPrisma.rentalPayment.update).not.toHaveBeenCalled();
  });

  it("skips inactive template", async () => {
    mockedPrisma.rentalPayment.findMany.mockResolvedValue([makePayment()]);
    mockedPrisma.emailTemplate.findUnique.mockResolvedValue({
      isActive: false,
      subject: "",
      bodyHtml: "",
      bodyText: null,
      key: "rental.payment_reminder_pre",
    });
    const stats = await sendPreReminders(5, new Date("2026-04-26"));
    expect(stats.sent).toBe(0);
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });
});

describe("sendDueReminders", () => {
  it("queries with today-only window", async () => {
    mockedPrisma.rentalPayment.findMany.mockResolvedValue([]);
    await sendDueReminders(new Date("2026-05-01T12:00:00Z"));
    const call = mockedPrisma.rentalPayment.findMany.mock.calls[0][0];
    expect(call.where.dueDateReminderSentAt).toBe(null);
    expect(call.where.contract.status.in).toEqual(["ACTIVE", "EXPIRING"]);
  });
});

describe("escalateOverdue", () => {
  it("creates task, sends telegram, marks escalatedAt", async () => {
    const payment = makePayment({ dueDate: new Date("2026-04-01") });
    mockedPrisma.rentalPayment.findMany.mockResolvedValue([payment]);
    mockedPrisma.managerTask.create.mockResolvedValue({ id: "task1" });
    mockedPrisma.rentalPayment.update.mockResolvedValue({});

    const stats = await escalateOverdue(5, new Date("2026-04-10T12:00:00Z"));
    expect(stats.tasksCreated).toBe(1);
    expect(stats.telegramSent).toBe(1);
    expect(mockedPrisma.managerTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "OVERDUE_PAYMENT",
          paymentId: payment.id,
        }),
      })
    );
    expect(mockedPrisma.rentalPayment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ escalatedAt: expect.any(Date) }),
      })
    );
  });

  it("handles P2002 as already-escalated (no dupe)", async () => {
    const payment = makePayment({ dueDate: new Date("2026-04-01") });
    mockedPrisma.rentalPayment.findMany.mockResolvedValue([payment]);
    mockedPrisma.managerTask.create.mockRejectedValue({ code: "P2002" });
    mockedPrisma.rentalPayment.update.mockResolvedValue({});
    const stats = await escalateOverdue(5, new Date("2026-04-10"));
    // tasksCreated stays 0 but escalatedAt still set to avoid infinite retries
    expect(stats.tasksCreated).toBe(0);
    expect(mockedPrisma.rentalPayment.update).toHaveBeenCalled();
  });

  it("does not telegram when disabled", async () => {
    mockedPrisma.rentalNotificationSettings.findUnique.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      escalationTelegramEnabled: false,
    });
    mockedPrisma.rentalNotificationSettings.upsert.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      escalationTelegramEnabled: false,
    });
    const payment = makePayment({ dueDate: new Date("2026-04-01") });
    mockedPrisma.rentalPayment.findMany.mockResolvedValue([payment]);
    mockedPrisma.managerTask.create.mockResolvedValue({ id: "task1" });
    mockedPrisma.rentalPayment.update.mockResolvedValue({});
    const stats = await escalateOverdue(5, new Date("2026-04-10"));
    expect(stats.telegramSent).toBe(0);
    expect(mockedSendTelegram).not.toHaveBeenCalled();
  });

  it("skips TERMINATED / EXPIRED via prisma filter", async () => {
    mockedPrisma.rentalPayment.findMany.mockResolvedValue([]);
    await escalateOverdue(5, new Date());
    const call = mockedPrisma.rentalPayment.findMany.mock.calls[0][0];
    expect(call.where.contract.status.in).toEqual(["ACTIVE", "EXPIRING"]);
  });
});

describe("runRentalPaymentReminders", () => {
  it("skips everything when autoSendEnabled=false", async () => {
    mockedPrisma.rentalNotificationSettings.findUnique.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      autoSendEnabled: false,
    });
    mockedPrisma.rentalNotificationSettings.upsert.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      autoSendEnabled: false,
    });
    const r = await runRentalPaymentReminders();
    expect(r.skipped).toBeTruthy();
    expect(mockedPrisma.rentalPayment.findMany).not.toHaveBeenCalled();
  });
});
