import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.stubGlobal("fetch", mockFetch);

import { VkChannel } from "../vk";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("VkChannel.isAvailable()", () => {
  it("returns false when token is not set", () => {
    const ch = new VkChannel(undefined);
    expect(ch.isAvailable()).toBe(false);
  });

  it("returns true when token is provided", () => {
    const ch = new VkChannel("community-token");
    expect(ch.isAvailable()).toBe(true);
  });
});

describe("VkChannel.send()", () => {
  const payload = { title: "Привет", body: "Ваше бронирование подтверждено" };

  it("returns non-retryable failure when token is missing", async () => {
    const ch = new VkChannel(undefined);
    const result = await ch.send("123456", payload);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryable).toBe(false);
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns ok true and externalId on success", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ response: 42 }),
    });
    const ch = new VkChannel("tok");
    const result = await ch.send("123456", payload);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.externalId).toBe("42");
  });

  it("sends POST to api.vk.com/method/messages.send", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ response: 1 }),
    });
    const ch = new VkChannel("tok");
    await ch.send("777", payload);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.vk.com/method/messages.send",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("returns non-retryable failure for VK error 901 (user hasn't opened dialog)", async () => {
    mockFetch.mockResolvedValueOnce({
      status: 200,
      json: async () => ({
        error: { error_code: 901, error_msg: "Can't send messages to this user" },
      }),
    });
    const ch = new VkChannel("tok");
    const result = await ch.send("123456", payload);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryable).toBe(false);
      expect(result.reason).toContain("901");
    }
  });

  it("returns retryable failure on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network timeout"));
    const ch = new VkChannel("tok");
    const result = await ch.send("123456", payload);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryable).toBe(true);
    }
  });

  it("includes action URLs in the message text", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ response: 1 }),
    });
    const ch = new VkChannel("tok");
    await ch.send("123456", {
      title: "Title",
      body: "Body",
      actions: [{ label: "Перейти", url: "https://example.com" }],
    });
    const body = mockFetch.mock.calls[0][1].body as URLSearchParams;
    expect(body.get("message")).toContain("https://example.com");
  });
});
