import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockUser, mockConsumeSignInNonce } = vi.hoisted(() => ({
  mockUser: { findUnique: vi.fn() },
  mockConsumeSignInNonce: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { user: mockUser },
}));

vi.mock("../email-magic-link.service", () => ({
  consumeSignInNonce: mockConsumeSignInNonce,
}));

import { authorizeMagicLinkNonce } from "../magic-link-authorize";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("authorizeMagicLinkNonce — security boundary", () => {
  it("returns null when credentials is undefined", async () => {
    const result = await authorizeMagicLinkNonce(undefined);
    expect(result).toBeNull();
    expect(mockConsumeSignInNonce).not.toHaveBeenCalled();
  });

  it("returns null when nonce is missing from credentials", async () => {
    const result = await authorizeMagicLinkNonce({});
    expect(result).toBeNull();
    expect(mockConsumeSignInNonce).not.toHaveBeenCalled();
  });

  it("returns null when nonce is not a string", async () => {
    const result = await authorizeMagicLinkNonce({ nonce: 12345 });
    expect(result).toBeNull();
    expect(mockConsumeSignInNonce).not.toHaveBeenCalled();
  });

  it("returns null and never queries the user table when nonce is empty", async () => {
    const result = await authorizeMagicLinkNonce({ nonce: "" });
    expect(result).toBeNull();
    expect(mockConsumeSignInNonce).not.toHaveBeenCalled();
    expect(mockUser.findUnique).not.toHaveBeenCalled();
  });

  it("returns null when consumeSignInNonce returns null (unknown/consumed nonce)", async () => {
    mockConsumeSignInNonce.mockResolvedValue(null);
    const result = await authorizeMagicLinkNonce({ nonce: "deadbeef" });
    expect(result).toBeNull();
    expect(mockUser.findUnique).not.toHaveBeenCalled();
  });

  it("returns the user when nonce is valid", async () => {
    mockConsumeSignInNonce.mockResolvedValue("user-1");
    mockUser.findUnique.mockResolvedValue({
      id: "user-1",
      email: "u@e.com",
    });
    const result = await authorizeMagicLinkNonce({ nonce: "valid-nonce" });
    expect(result).toEqual({ id: "user-1", email: "u@e.com" });
    expect(mockConsumeSignInNonce).toHaveBeenCalledWith("valid-nonce");
    expect(mockUser.findUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
    });
  });

  it("never accepts bare userId in the place of nonce — the very vulnerability we closed", async () => {
    // Even if attacker sends a real cuid as the "nonce", consumeSignInNonce
    // does GETDEL on Redis "magic-link:signin:<cuid>" — which doesn't exist —
    // and returns null. authorize must return null.
    mockConsumeSignInNonce.mockResolvedValue(null);
    const result = await authorizeMagicLinkNonce({
      nonce: "ckabcdefghij123456",
    });
    expect(result).toBeNull();
    expect(mockUser.findUnique).not.toHaveBeenCalled();
  });

  it("the same nonce cannot grant a session twice", async () => {
    // First call: nonce was valid
    mockConsumeSignInNonce.mockResolvedValueOnce("user-2");
    mockUser.findUnique.mockResolvedValue({ id: "user-2", email: null });
    const first = await authorizeMagicLinkNonce({ nonce: "n2" });
    expect(first).not.toBeNull();

    // Second call: GETDEL already removed it
    mockConsumeSignInNonce.mockResolvedValueOnce(null);
    const second = await authorizeMagicLinkNonce({ nonce: "n2" });
    expect(second).toBeNull();
  });
});
