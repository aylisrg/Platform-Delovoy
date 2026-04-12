import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Prisma
vi.mock("@/lib/db", () => ({
  prisma: {
    module: {
      findUnique: vi.fn(),
    },
    booking: {
      findFirst: vi.fn(),
    },
    callLog: {
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
  },
}));

// Mock logger
vi.mock("@/lib/logger", () => ({
  log: {
    info: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
  },
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

// Mock novofon-client
vi.mock("../novofon-client", () => ({
  novofonStartCall: vi.fn(),
  novofonCheckStatus: vi.fn(),
}));

import { prisma } from "@/lib/db";
import { novofonStartCall, novofonCheckStatus } from "../novofon-client";
import {
  getTelephonyConfig,
  getPublicPhone,
  initiateCall,
  handleWebhook,
  listCallsByBooking,
  listCalls,
  getRecordingUrl,
  getTelephonyHealth,
  TelephonyError,
} from "../service";

const mockPrisma = prisma as unknown as {
  module: { findUnique: ReturnType<typeof vi.fn> };
  booking: { findFirst: ReturnType<typeof vi.fn> };
  callLog: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  user: { findMany: ReturnType<typeof vi.fn> };
};

const mockNovofonStartCall = novofonStartCall as ReturnType<typeof vi.fn>;
const mockNovofonCheckStatus = novofonCheckStatus as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
  // Reset env var
  process.env.NOVOFON_API_KEY = "test-api-key";
});

describe("getTelephonyConfig", () => {
  it("returns null when module not found", async () => {
    mockPrisma.module.findUnique.mockResolvedValue(null);
    const result = await getTelephonyConfig("gazebos");
    expect(result).toBeNull();
  });

  it("returns null when telephony disabled", async () => {
    mockPrisma.module.findUnique.mockResolvedValue({
      isActive: true,
      config: { telephony: { enabled: false } },
    });
    const result = await getTelephonyConfig("gazebos");
    expect(result).toBeNull();
  });

  it("returns config when telephony enabled", async () => {
    mockPrisma.module.findUnique.mockResolvedValue({
      isActive: true,
      config: {
        telephony: {
          enabled: true,
          publicPhone: "+74951234567",
          displayPhone: "+7 (495) 123-45-67",
          sipLine: "79991234567",
          callerId: "+74951234567",
        },
      },
    });
    const result = await getTelephonyConfig("gazebos");
    expect(result).not.toBeNull();
    expect(result?.publicPhone).toBe("+74951234567");
    expect(result?.sipLine).toBe("79991234567");
  });

  it("returns null when module isActive=false", async () => {
    mockPrisma.module.findUnique.mockResolvedValue({
      isActive: false,
      config: { telephony: { enabled: true } },
    });
    const result = await getTelephonyConfig("gazebos");
    expect(result).toBeNull();
  });
});

describe("getPublicPhone", () => {
  it("returns phone when config has publicPhone", async () => {
    mockPrisma.module.findUnique.mockResolvedValue({
      isActive: true,
      config: {
        telephony: {
          enabled: true,
          publicPhone: "+74951234567",
          displayPhone: "+7 (495) 123-45-67",
          sipLine: "sip",
        },
      },
    });
    const result = await getPublicPhone("gazebos");
    expect(result).not.toBeNull();
    expect(result?.phone).toBe("+74951234567");
    expect(result?.displayPhone).toBe("+7 (495) 123-45-67");
  });

  it("returns null when telephony disabled", async () => {
    mockPrisma.module.findUnique.mockResolvedValue({
      isActive: true,
      config: { telephony: { enabled: false } },
    });
    const result = await getPublicPhone("gazebos");
    expect(result).toBeNull();
  });
});

describe("initiateCall", () => {
  const makeModuleConfig = () => ({
    isActive: true,
    config: {
      telephony: {
        enabled: true,
        publicPhone: "+74951234567",
        displayPhone: "+7 (495) 123-45-67",
        sipLine: "79991234567",
      },
    },
  });

  const makeBooking = () => ({
    id: "booking-1",
    clientPhone: "+79001234567",
    moduleSlug: "gazebos",
  });

  const makeCallLog = (status = "INITIATED") => ({
    id: "calllog-1",
    bookingId: "booking-1",
    moduleSlug: "gazebos",
    direction: "OUTBOUND",
    status,
    clientPhone: "+79001234567",
    managerPhone: "79991234567",
    initiatedBy: "manager-1",
    externalCallId: null,
    duration: null,
    recordingUrl: null,
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  it("initiates call successfully", async () => {
    mockPrisma.booking.findFirst.mockResolvedValue(makeBooking());
    mockPrisma.module.findUnique.mockResolvedValue(makeModuleConfig());
    mockPrisma.callLog.create.mockResolvedValue(makeCallLog("INITIATED"));
    mockNovofonStartCall.mockResolvedValue({ success: true, call_id: "ext-123" });
    mockPrisma.callLog.update.mockResolvedValue(makeCallLog("RINGING"));

    const result = await initiateCall("manager-1", "booking-1", "gazebos");

    expect(mockNovofonStartCall).toHaveBeenCalledWith("test-api-key", {
      from: "79991234567",
      to: "+79001234567",
      caller_id: "+74951234567",
    });
    expect(mockPrisma.callLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "RINGING", externalCallId: "ext-123" }),
      })
    );
    expect(result.status).toBe("RINGING");
  });

  it("throws BOOKING_NOT_FOUND when booking missing", async () => {
    mockPrisma.booking.findFirst.mockResolvedValue(null);
    await expect(initiateCall("manager-1", "nonexistent", "gazebos")).rejects.toMatchObject({
      code: "BOOKING_NOT_FOUND",
    });
  });

  it("throws NO_CLIENT_PHONE when booking has no phone", async () => {
    mockPrisma.booking.findFirst.mockResolvedValue({
      id: "booking-1",
      clientPhone: null,
      moduleSlug: "gazebos",
    });
    await expect(initiateCall("manager-1", "booking-1", "gazebos")).rejects.toMatchObject({
      code: "NO_CLIENT_PHONE",
    });
  });

  it("throws TELEPHONY_DISABLED when config disabled", async () => {
    mockPrisma.booking.findFirst.mockResolvedValue(makeBooking());
    mockPrisma.module.findUnique.mockResolvedValue({
      isActive: true,
      config: { telephony: { enabled: false } },
    });
    await expect(initiateCall("manager-1", "booking-1", "gazebos")).rejects.toMatchObject({
      code: "TELEPHONY_DISABLED",
    });
  });

  it("throws TELEPHONY_NOT_CONFIGURED when API key missing", async () => {
    delete process.env.NOVOFON_API_KEY;
    mockPrisma.booking.findFirst.mockResolvedValue(makeBooking());
    mockPrisma.module.findUnique.mockResolvedValue(makeModuleConfig());
    mockPrisma.callLog.create.mockResolvedValue(makeCallLog());

    await expect(initiateCall("manager-1", "booking-1", "gazebos")).rejects.toMatchObject({
      code: "TELEPHONY_NOT_CONFIGURED",
    });
  });

  it("throws NOVOFON_ERROR when API returns failure", async () => {
    mockPrisma.booking.findFirst.mockResolvedValue(makeBooking());
    mockPrisma.module.findUnique.mockResolvedValue(makeModuleConfig());
    mockPrisma.callLog.create.mockResolvedValue(makeCallLog());
    mockNovofonStartCall.mockResolvedValue({ success: false, error: "SIP not found" });
    mockPrisma.callLog.update.mockResolvedValue(makeCallLog("FAILED"));

    await expect(initiateCall("manager-1", "booking-1", "gazebos")).rejects.toMatchObject({
      code: "NOVOFON_ERROR",
      httpStatus: 503,
    });
  });
});

describe("handleWebhook", () => {
  it("updates existing CallLog by externalCallId", async () => {
    const existing = {
      id: "calllog-1",
      status: "RINGING",
      duration: null,
      recordingUrl: null,
    };
    mockPrisma.callLog.findFirst.mockResolvedValue(existing);
    mockPrisma.callLog.update.mockResolvedValue({ ...existing, status: "COMPLETED" });

    await handleWebhook({
      event: "call.completed",
      call_id: "ext-123",
      duration: 120,
      recording_url: "https://storage.novofon.com/rec/abc.mp3",
    });

    expect(mockPrisma.callLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "calllog-1" },
        data: expect.objectContaining({ status: "COMPLETED", duration: 120 }),
      })
    );
  });

  it("creates inbound CallLog with booking attribution", async () => {
    mockPrisma.callLog.findFirst
      .mockResolvedValueOnce(null) // no existing by externalCallId
      .mockResolvedValueOnce({ id: "booking-1" }); // booking found by phone — wrong! need booking.findFirst
    mockPrisma.booking.findFirst.mockResolvedValue({ id: "booking-1" });
    mockPrisma.callLog.create.mockResolvedValue({ id: "calllog-new" });

    await handleWebhook({
      event: "call.ringing",
      call_id: "ext-456",
      direction: "inbound",
      caller: "+79001234567",
    });

    expect(mockPrisma.callLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          direction: "INBOUND",
          clientPhone: "+79001234567",
          bookingId: "booking-1",
        }),
      })
    );
  });

  it("creates unattributed inbound CallLog when no booking found", async () => {
    mockPrisma.callLog.findFirst.mockResolvedValue(null);
    mockPrisma.booking.findFirst.mockResolvedValue(null);
    mockPrisma.callLog.create.mockResolvedValue({ id: "calllog-new" });

    await handleWebhook({
      event: "call.ringing",
      call_id: "ext-789",
      direction: "inbound",
      caller: "+79001111111",
    });

    expect(mockPrisma.callLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          direction: "INBOUND",
          bookingId: null,
        }),
      })
    );
  });
});

describe("listCallsByBooking", () => {
  it("returns calls for a booking", async () => {
    const calls = [
      {
        id: "c1",
        initiatedBy: "manager-1",
        bookingId: "booking-1",
        status: "COMPLETED",
        direction: "OUTBOUND",
        clientPhone: "+79001234567",
        managerPhone: "sip",
        externalCallId: "ext-1",
        duration: 60,
        recordingUrl: null,
        errorMessage: null,
        moduleSlug: "gazebos",
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    mockPrisma.callLog.findMany.mockResolvedValue(calls);
    mockPrisma.user.findMany.mockResolvedValue([{ id: "manager-1", name: "Иван" }]);

    const result = await listCallsByBooking("booking-1");
    expect(result).toHaveLength(1);
    expect(result[0].initiatedByName).toBe("Иван");
  });
});

describe("listCalls", () => {
  it("paginates results correctly", async () => {
    mockPrisma.callLog.findMany.mockResolvedValue([]);
    mockPrisma.callLog.count.mockResolvedValue(0);
    mockPrisma.user.findMany.mockResolvedValue([]);

    const result = await listCalls({ page: 1, perPage: 20 });
    expect(mockPrisma.callLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20, skip: 0 })
    );
    expect(result.total).toBe(0);
  });

  it("passes filters to prisma query", async () => {
    mockPrisma.callLog.findMany.mockResolvedValue([]);
    mockPrisma.callLog.count.mockResolvedValue(0);
    mockPrisma.user.findMany.mockResolvedValue([]);

    await listCalls({
      bookingId: "booking-1",
      moduleSlug: "gazebos",
      status: "COMPLETED",
      page: 1,
      perPage: 20,
    });

    expect(mockPrisma.callLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          bookingId: "booking-1",
          moduleSlug: "gazebos",
          status: "COMPLETED",
        }),
      })
    );
  });
});

describe("getRecordingUrl", () => {
  it("returns recording URL when present", async () => {
    mockPrisma.callLog.findUnique.mockResolvedValue({
      recordingUrl: "https://storage.novofon.com/rec/abc.mp3",
      status: "COMPLETED",
    });

    const url = await getRecordingUrl("calllog-1");
    expect(url).toBe("https://storage.novofon.com/rec/abc.mp3");
  });

  it("returns null when recording not available", async () => {
    mockPrisma.callLog.findUnique.mockResolvedValue({
      recordingUrl: null,
      status: "RINGING",
    });

    const url = await getRecordingUrl("calllog-1");
    expect(url).toBeNull();
  });

  it("returns null when call not found", async () => {
    mockPrisma.callLog.findUnique.mockResolvedValue(null);
    const url = await getRecordingUrl("nonexistent");
    expect(url).toBeNull();
  });
});

describe("getTelephonyHealth", () => {
  it("returns ok status when novofon configured", async () => {
    mockNovofonCheckStatus.mockResolvedValue({ configured: true, balance: "100.00" });
    mockPrisma.callLog.count.mockResolvedValue(5);
    mockPrisma.callLog.findFirst.mockResolvedValue({ createdAt: new Date() });

    const health = await getTelephonyHealth();
    expect(health.status).toBe("ok");
    expect(health.novofonApiConfigured).toBe(true);
    expect(health.totalCallsToday).toBe(5);
  });

  it("returns degraded status when novofon not configured", async () => {
    mockNovofonCheckStatus.mockResolvedValue({ configured: false, error: "Invalid key" });
    mockPrisma.callLog.count.mockResolvedValue(0);
    mockPrisma.callLog.findFirst.mockResolvedValue(null);

    const health = await getTelephonyHealth();
    expect(health.status).toBe("degraded");
    expect(health.novofonApiConfigured).toBe(false);
  });
});

describe("TelephonyError", () => {
  it("has code and httpStatus properties", () => {
    const err = new TelephonyError("TEST_CODE", "Test message", 503);
    expect(err.code).toBe("TEST_CODE");
    expect(err.message).toBe("Test message");
    expect(err.httpStatus).toBe(503);
    expect(err.name).toBe("TelephonyError");
  });

  it("defaults httpStatus to 400", () => {
    const err = new TelephonyError("BAD", "Bad request");
    expect(err.httpStatus).toBe(400);
  });
});
