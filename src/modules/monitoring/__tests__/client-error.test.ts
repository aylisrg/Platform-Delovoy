import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    systemEvent: {
      create: vi.fn(),
    },
  },
}));

import { clientErrorSchema } from "../validation";
import { logClientError } from "../service";
import { prisma } from "@/lib/db";

const mockedCreate = vi.mocked(prisma.systemEvent.create);

describe("clientErrorSchema", () => {
  it("accepts a minimal valid payload", () => {
    const parsed = clientErrorSchema.safeParse({
      message: "ChunkLoadError: Loading chunk 5 failed",
      source: "window-error",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts optional url and userAgent", () => {
    const parsed = clientErrorSchema.safeParse({
      message: "boom",
      source: "unhandled-rejection",
      url: "https://delovoy-park.ru/gazebos",
      userAgent: "Mozilla/5.0",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects malformed payloads", () => {
    const badPayloads: unknown[] = [
      { source: "window-error" }, // missing message
      { message: "", source: "window-error" }, // empty message
      { message: "x".repeat(501), source: "window-error" }, // message too long
      { message: "ok", source: "invalid" }, // unknown source
      { message: "ok", source: "window-error", url: "u".repeat(301) }, // url too long
    ];
    for (const payload of badPayloads) {
      expect(clientErrorSchema.safeParse(payload).success).toBe(false);
    }
  });
});

describe("logClientError", () => {
  beforeEach(() => {
    mockedCreate.mockReset();
  });

  it("writes a WARNING SystemEvent with beacon metadata", async () => {
    mockedCreate.mockResolvedValue({ id: "ev1" } as never);
    await logClientError({
      message: "ChunkLoadError",
      source: "window-error",
      url: "https://delovoy-park.ru/",
      userAgent: "Safari",
    });
    expect(mockedCreate).toHaveBeenCalledWith({
      data: {
        level: "WARNING",
        source: "client-beacon",
        message: "ChunkLoadError",
        metadata: {
          beaconSource: "window-error",
          url: "https://delovoy-park.ru/",
          userAgent: "Safari",
        },
      },
    });
  });

  it("omits absent optional fields from metadata", async () => {
    mockedCreate.mockResolvedValue({ id: "ev2" } as never);
    await logClientError({ message: "boom", source: "unhandled-rejection" });
    const arg = mockedCreate.mock.calls[0]?.[0];
    expect(arg?.data.metadata).toEqual({ beaconSource: "unhandled-rejection" });
  });
});
