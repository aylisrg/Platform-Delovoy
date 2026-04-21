import { describe, it, expect, beforeEach } from "vitest";

import { resolveChannelForUser, getAdapter } from "../channels/index";
import { telegramAdapter } from "../channels/telegram";
import { emailAdapter } from "../channels/email";
import { vkAdapter } from "../channels/vk";
import type { UserWithContacts } from "../types";

beforeEach(() => {});

const fullUser: UserWithContacts = {
  id: "user-1",
  name: "Test",
  email: "test@example.com",
  phone: "+79991234567",
  telegramId: "123456",
  vkId: "vk-789",
};

describe("resolveChannelForUser", () => {
  it("returns Telegram when user has telegramId (AUTO priority)", () => {
    const result = resolveChannelForUser(fullUser);
    expect(result).toEqual({ channel: "TELEGRAM", recipient: "123456" });
  });

  it("returns Email when no telegramId", () => {
    const result = resolveChannelForUser({ ...fullUser, telegramId: null });
    expect(result).toEqual({ channel: "EMAIL", recipient: "test@example.com" });
  });

  it("returns VK when no TG or email", () => {
    const result = resolveChannelForUser({
      ...fullUser,
      telegramId: null,
      email: null,
    });
    expect(result).toEqual({ channel: "VK", recipient: "vk-789" });
  });

  it("returns null when no contact info", () => {
    const result = resolveChannelForUser({
      ...fullUser,
      telegramId: null,
      phone: null,
      email: null,
      vkId: null,
    });
    expect(result).toBeNull();
  });

  it("respects preferred channel", () => {
    const result = resolveChannelForUser(fullUser, "EMAIL");
    expect(result).toEqual({ channel: "EMAIL", recipient: "test@example.com" });
  });

  it("falls back to AUTO if preferred channel has no recipient", () => {
    const result = resolveChannelForUser(
      { ...fullUser, vkId: null },
      "VK"
    );
    expect(result).toEqual({ channel: "TELEGRAM", recipient: "123456" });
  });

  it("returns null for WHATSAPP preference (channel removed)", () => {
    const result = resolveChannelForUser(fullUser, "WHATSAPP");
    // adapter not registered → falls back to AUTO
    expect(result).toEqual({ channel: "TELEGRAM", recipient: "123456" });
  });
});

describe("getAdapter", () => {
  it("returns null for AUTO", () => {
    expect(getAdapter("AUTO")).toBeNull();
  });

  it("returns telegram adapter", () => {
    expect(getAdapter("TELEGRAM")).toBe(telegramAdapter);
  });

  it("returns null for WHATSAPP (channel removed)", () => {
    expect(getAdapter("WHATSAPP")).toBeNull();
  });

  it("returns email adapter", () => {
    expect(getAdapter("EMAIL")).toBe(emailAdapter);
  });

  it("returns vk adapter", () => {
    expect(getAdapter("VK")).toBe(vkAdapter);
  });
});

describe("telegramAdapter", () => {
  it("resolves recipient from telegramId", () => {
    expect(telegramAdapter.resolveRecipient(fullUser)).toBe("123456");
  });

  it("returns null when no telegramId", () => {
    expect(
      telegramAdapter.resolveRecipient({ ...fullUser, telegramId: null })
    ).toBeNull();
  });

  it("returns error when no bot token", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const result = await telegramAdapter.send("123", "test");
    expect(result.success).toBe(false);
    expect(result.error).toContain("not configured");
  });
});

describe("emailAdapter", () => {
  it("resolves recipient from email", () => {
    expect(emailAdapter.resolveRecipient(fullUser)).toBe("test@example.com");
  });

  it("returns success (placeholder)", async () => {
    const result = await emailAdapter.send("test@example.com", "Hello");
    expect(result.success).toBe(true);
  });
});

describe("vkAdapter", () => {
  it("resolves recipient from vkId", () => {
    expect(vkAdapter.resolveRecipient(fullUser)).toBe("vk-789");
  });

  it("returns success (placeholder)", async () => {
    const result = await vkAdapter.send("vk-789", "Hello");
    expect(result.success).toBe(true);
  });
});
