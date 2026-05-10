import { describe, expect, it } from "vitest";
import {
  isAllowedPushEndpoint,
  webPushSubscribeSchema,
  webPushUnsubscribeSchema,
} from "../validation";

describe("isAllowedPushEndpoint", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc123",
    "https://web.push.apple.com/Q1c...",
    "https://api.push.apple.com/3/device/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://wns2-bn1.notify.windows.com/?token=xyz",
  ])("allows %s", (url) => {
    expect(isAllowedPushEndpoint(url)).toBe(true);
  });

  it.each([
    "https://evil.com/fake-push",
    "http://fcm.googleapis.com/fcm/send/abc", // http, not https
    "ftp://fcm.googleapis.com/x",
    "not-a-url",
    "",
    "https://attacker.fcm.googleapis.com.evil.com/x",
  ])("rejects %s", (url) => {
    expect(isAllowedPushEndpoint(url)).toBe(false);
  });
});

describe("webPushSubscribeSchema", () => {
  const valid = {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
    keys: { p256dh: "BPublicKey", auth: "AuthSecret" },
    userAgent: "Chrome 120",
  };

  it("accepts valid payload", () => {
    expect(webPushSubscribeSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects empty p256dh", () => {
    const r = webPushSubscribeSchema.safeParse({
      ...valid,
      keys: { p256dh: "", auth: "x" },
    });
    expect(r.success).toBe(false);
  });

  it("rejects endpoint at non-allowlisted host", () => {
    const r = webPushSubscribeSchema.safeParse({
      ...valid,
      endpoint: "https://evil.example.com/abc",
    });
    expect(r.success).toBe(false);
  });

  it("rejects endpoint longer than 2000 chars", () => {
    const r = webPushSubscribeSchema.safeParse({
      ...valid,
      endpoint: "https://fcm.googleapis.com/fcm/send/" + "a".repeat(2050),
    });
    expect(r.success).toBe(false);
  });

  it("rejects userAgent over 500 chars", () => {
    const r = webPushSubscribeSchema.safeParse({
      ...valid,
      userAgent: "x".repeat(501),
    });
    expect(r.success).toBe(false);
  });

  it("treats userAgent as optional", () => {
    const { userAgent: _ua, ...withoutUa } = valid;
    expect(webPushSubscribeSchema.safeParse(withoutUa).success).toBe(true);
  });
});

describe("webPushUnsubscribeSchema", () => {
  it("accepts valid endpoint", () => {
    expect(
      webPushUnsubscribeSchema.safeParse({
        endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      }).success,
    ).toBe(true);
  });

  it("rejects non-URL", () => {
    expect(
      webPushUnsubscribeSchema.safeParse({ endpoint: "abc" }).success,
    ).toBe(false);
  });

  it("rejects non-allowlisted endpoint host (SSRF allowlist consistent with subscribe)", () => {
    const r = webPushUnsubscribeSchema.safeParse({
      endpoint: "https://evil.example.com/push/abc",
    });
    expect(r.success).toBe(false);
  });

  it("rejects http endpoint even on allowlisted host", () => {
    const r = webPushUnsubscribeSchema.safeParse({
      endpoint: "http://fcm.googleapis.com/fcm/send/abc",
    });
    expect(r.success).toBe(false);
  });
});
