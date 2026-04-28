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
  constantTimeCompare,
  constantTimeEquals,
  verifyWebhookToken,
  verifyAvitoWebhookToken,
} from "../webhook-security";

beforeEach(() => {
  findUniqueMock.mockReset();
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

describe("constantTimeCompare", () => {
  it("returns true for identical non-empty strings", () => {
    expect(constantTimeCompare("abc123", "abc123")).toBe(true);
  });

  it("returns false for length mismatch (no timing leak)", () => {
    expect(constantTimeCompare("abc123", "abc1234")).toBe(false);
    expect(constantTimeCompare("a", "ab")).toBe(false);
  });

  it("returns false for different bytes of equal length", () => {
    expect(constantTimeCompare("aaaa", "aaab")).toBe(false);
    expect(constantTimeCompare("ZzZz", "zZzZ")).toBe(false);
  });

  it("returns false for empty strings", () => {
    expect(constantTimeCompare("", "")).toBe(false);
    expect(constantTimeCompare("", "abc")).toBe(false);
    expect(constantTimeCompare("abc", "")).toBe(false);
  });

  it("returns false for non-string inputs", () => {
    expect(
      // @ts-expect-error — runtime guard for bad callers
      constantTimeCompare(undefined, "abc")
    ).toBe(false);
    expect(
      // @ts-expect-error — runtime guard for bad callers
      constantTimeCompare("abc", null)
    ).toBe(false);
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

describe("verifyWebhookToken", () => {
  it("returns false when token is null", async () => {
    expect(await verifyWebhookToken(null)).toBe(false);
  });

  it("returns false when integration row missing", async () => {
    findUniqueMock.mockResolvedValueOnce(null);
    expect(await verifyWebhookToken("abc")).toBe(false);
  });

  it("returns false when webhookSecret is null", async () => {
    findUniqueMock.mockResolvedValueOnce({ webhookSecret: null });
    expect(await verifyWebhookToken("abc")).toBe(false);
  });

  it("returns false when token mismatches", async () => {
    findUniqueMock.mockResolvedValueOnce({ webhookSecret: "expected" });
    expect(await verifyWebhookToken("provided")).toBe(false);
  });

  it("returns true when token matches stored secret", async () => {
    findUniqueMock.mockResolvedValueOnce({ webhookSecret: "shared-secret" });
    expect(await verifyWebhookToken("shared-secret")).toBe(true);
  });
});
