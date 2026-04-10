import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/green-api", () => ({
  sendWhatsAppMessage: vi.fn(),
}));

import { resolveChannelForUser, getAdapter } from "../channels/index";
import { telegramAdapter } from "../channels/telegram";
import { whatsappAdapter } from "../channels/whatsapp";
import { emailAdapter } from "../channels/email";
import { vkAdapter } from "../channels/vk";
import { sendWhatsAppMessage } from "@/lib/green-api";
import type { UserWithContacts } from "../types";

beforeEach(() => {
  vi.clearAllMocks();
});

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

  it("returns WhatsApp when no telegramId", () => {
    const result = resolveChannelForUser({ ...fullUser, telegramId: null });
    expect(result).toEqual({ channel: "WHATSAPP", recipient: "+79991234567" });
  });

  it("returns Email when no TG or WA", () => {
    const result = resolveChannelForUser({
      ...fullUser,
      telegramId: null,
      phone: null,
    });
    expect(result).toEqual({ channel: "EMAIL", recipient: "test@example.com" });
  });

  it("returns VK as last resort", () => {
    const result = resolveChannelForUser({
      ...fullUser,
      telegramId: null,
      phone: null,
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
    // Should fall back to Telegram (AUTO priority)
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

  it("returns whatsapp adapter", () => {
    expect(getAdapter("WHATSAPP")).toBe(whatsappAdapter);
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

describe("whatsappAdapter", () => {
  it("resolves recipient from phone", () => {
    expect(whatsappAdapter.resolveRecipient(fullUser)).toBe("+79991234567");
  });

  it("delegates to sendWhatsAppMessage", async () => {
    vi.mocked(sendWhatsAppMessage).mockResolvedValue({
      success: true,
      messageId: "msg-1",
    });

    const result = await whatsappAdapter.send("+79991234567", "Hello");
    expect(sendWhatsAppMessage).toHaveBeenCalledWith("+79991234567", "Hello");
    expect(result.success).toBe(true);
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
