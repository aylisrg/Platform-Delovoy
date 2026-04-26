import { beforeEach, describe, expect, it } from "vitest";
import { ChannelRegistry } from "../channel-registry";
import type { INotificationChannel } from "../types";
import {
  IMessageChannel,
  MaxChannel,
  SmsChannel,
  WhatsAppChannel,
} from "../channels/stubs";

describe("ChannelRegistry", () => {
  beforeEach(() => ChannelRegistry.reset());

  it("register/get round-trip", () => {
    const ch: INotificationChannel = {
      kind: "TELEGRAM",
      isAvailable: () => true,
      send: async () => ({ ok: true }),
    };
    ChannelRegistry.register(ch);
    expect(ChannelRegistry.get("TELEGRAM")).toBe(ch);
  });

  it("get returns undefined for unknown kind", () => {
    expect(ChannelRegistry.get("PUSH")).toBeUndefined();
  });

  it("available() returns only channels reporting available=true", () => {
    const tg: INotificationChannel = {
      kind: "TELEGRAM",
      isAvailable: () => true,
      send: async () => ({ ok: true }),
    };
    ChannelRegistry.register(tg);
    ChannelRegistry.register(WhatsAppChannel);
    ChannelRegistry.register(MaxChannel);
    ChannelRegistry.register(SmsChannel);
    ChannelRegistry.register(IMessageChannel);
    expect(ChannelRegistry.available()).toEqual(["TELEGRAM"]);
  });
});

describe("Stub channels", () => {
  it("isAvailable returns false on every stub", () => {
    expect(WhatsAppChannel.isAvailable()).toBe(false);
    expect(MaxChannel.isAvailable()).toBe(false);
    expect(IMessageChannel.isAvailable()).toBe(false);
    expect(SmsChannel.isAvailable()).toBe(false);
  });

  it("send returns retryable=false with not-configured reason", async () => {
    const r = await WhatsAppChannel.send("any", { title: "t", body: "b" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.retryable).toBe(false);
      expect(r.reason).toMatch(/not yet configured/i);
    }
  });
});
