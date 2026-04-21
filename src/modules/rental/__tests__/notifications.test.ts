import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    rentalContract: { findUnique: vi.fn() },
    tenant: { findUnique: vi.fn() },
    emailTemplate: { findUnique: vi.fn() },
    emailLog: { create: vi.fn() },
    rentalNotificationSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock("@/modules/notifications/channels/email", () => ({
  sendTransactionalEmail: vi.fn(),
}));

import { prisma } from "@/lib/db";
import { sendTransactionalEmail } from "@/modules/notifications/channels/email";
import {
  sendManualEmail,
  resolveRecipients,
  RentalEmailError,
} from "@/modules/rental/notifications";

const mockedPrisma = prisma as unknown as {
  rentalContract: { findUnique: ReturnType<typeof vi.fn> };
  tenant: { findUnique: ReturnType<typeof vi.fn> };
  emailTemplate: { findUnique: ReturnType<typeof vi.fn> };
  emailLog: { create: ReturnType<typeof vi.fn> };
  rentalNotificationSettings: {
    findUnique: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
};
const mockedSend = sendTransactionalEmail as ReturnType<typeof vi.fn>;

const SETTINGS = {
  id: "singleton",
  preReminderDays: 5,
  escalationDaysAfter: 5,
  autoSendEnabled: true,
  fromEmail: "buh@delovoy-park.ru",
  fromName: "Buh",
  bankDetails: "",
  managerName: "",
  managerPhone: "",
  escalationTelegramEnabled: false,
  escalationTelegramChatId: null,
  updatedAt: new Date(),
  updatedById: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedPrisma.rentalNotificationSettings.findUnique.mockResolvedValue(SETTINGS);
  mockedPrisma.rentalNotificationSettings.upsert.mockResolvedValue(SETTINGS);
  mockedPrisma.emailLog.create.mockResolvedValue({ id: "log1" });
  mockedSend.mockResolvedValue({ success: true });
});

describe("resolveRecipients", () => {
  it("merges primary + extra emails, deduplicated", () => {
    const r = resolveRecipients({
      email: "a@x.ru",
      emailsExtra: ["b@x.ru", "a@x.ru"],
    } as never);
    expect(r).toEqual(["a@x.ru", "b@x.ru"]);
  });
  it("returns empty when nothing set", () => {
    const r = resolveRecipients({ email: null, emailsExtra: null } as never);
    expect(r).toEqual([]);
  });
});

describe("sendManualEmail", () => {
  it("throws NO_RECIPIENT when tenant has no email", async () => {
    mockedPrisma.tenant.findUnique.mockResolvedValue({
      id: "t1",
      companyName: "X",
      contactName: null,
      email: null,
      emailsExtra: null,
      isDeleted: false,
    });
    await expect(
      sendManualEmail({
        tenantId: "t1",
        to: ["a@x.ru"],
        customSubject: "hi",
        customBodyHtml: "<p>hi</p>",
        sentById: "u1",
      })
    ).rejects.toThrow(RentalEmailError);
  });

  it("rejects addresses not in tenant.email/emailsExtra", async () => {
    mockedPrisma.tenant.findUnique.mockResolvedValue({
      id: "t1",
      companyName: "X",
      contactName: null,
      email: "real@x.ru",
      emailsExtra: null,
      isDeleted: false,
    });
    await expect(
      sendManualEmail({
        tenantId: "t1",
        to: ["attacker@evil.com"],
        customSubject: "hi",
        customBodyHtml: "<p>hi</p>",
        sentById: "u1",
      })
    ).rejects.toMatchObject({ code: "NO_VALID_RECIPIENT" });
  });

  it("requires templateKey or custom content", async () => {
    mockedPrisma.tenant.findUnique.mockResolvedValue({
      id: "t1",
      companyName: "X",
      contactName: null,
      email: "a@x.ru",
      emailsExtra: null,
      isDeleted: false,
    });
    await expect(
      sendManualEmail({
        tenantId: "t1",
        to: ["a@x.ru"],
        sentById: "u1",
      })
    ).rejects.toMatchObject({ code: "CONTENT_REQUIRED" });
  });

  it("sends and records EmailLog entries per recipient", async () => {
    mockedPrisma.tenant.findUnique.mockResolvedValue({
      id: "t1",
      companyName: "X",
      contactName: "Ivan",
      email: "a@x.ru",
      emailsExtra: ["b@x.ru"],
      isDeleted: false,
    });
    mockedPrisma.emailTemplate.findUnique.mockResolvedValue({
      key: "rental.manual",
      isActive: true,
      subject: "Hi {{contactName}}",
      bodyHtml: "<p>{{contactName}}</p>",
      bodyText: null,
    });

    const r = await sendManualEmail({
      tenantId: "t1",
      to: ["a@x.ru", "b@x.ru"],
      templateKey: "rental.manual",
      sentById: "u1",
    });

    expect(r.sent.length).toBe(2);
    expect(mockedSend).toHaveBeenCalledTimes(2);
    expect(mockedSend.mock.calls[0][0]).toMatchObject({
      from: "buh@delovoy-park.ru",
      to: "a@x.ru",
    });
    expect(mockedPrisma.emailLog.create).toHaveBeenCalledTimes(2);
  });
});
