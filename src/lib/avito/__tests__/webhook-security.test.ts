import { describe, it, expect, vi, beforeEach } from "vitest";

const { findUniqueMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    avitoIntegration: { findUnique: findUniqueMock },
  },
}));

import {
  constantTimeEquals,
  verifyAvitoWebhookToken,
} from "../webhook-security";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("constantTimeEquals", () => {
  it("returns true for identical strings", () => {
    expect(constantTimeEquals("abc123", "abc123")).toBe(true);
  });

  it("returns false for different strings of equal length", () => {
    expect(constantTimeEquals("abc123", "xyz789")).toBe(false);
  });

  it("returns false for strings of different lengths", () => {
    expect(constantTimeEquals("abc", "abcdef")).toBe(false);
  });

  it("returns false for empty + nonempty", () => {
    expect(constantTimeEquals("", "secret")).toBe(false);
  });
});

describe("verifyAvitoWebhookToken", () => {
  it("rejects missing token", async () => {
    const r = await verifyAvitoWebhookToken(null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("MISSING_TOKEN");
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("rejects empty string", async () => {
    const r = await verifyAvitoWebhookToken("");
    expect(r.ok).toBe(false);
  });

  it("rejects when AvitoIntegration row has no webhookSecret", async () => {
    findUniqueMock.mockResolvedValue({ webhookSecret: null });
    const r = await verifyAvitoWebhookToken("anything");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("NOT_CONFIGURED");
  });

  it("rejects mismatched token", async () => {
    findUniqueMock.mockResolvedValue({ webhookSecret: "real-secret" });
    const r = await verifyAvitoWebhookToken("forged");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("INVALID_TOKEN");
  });

  it("accepts matching token", async () => {
    findUniqueMock.mockResolvedValue({ webhookSecret: "abcd1234" });
    const r = await verifyAvitoWebhookToken("abcd1234");
    expect(r.ok).toBe(true);
  });
});
