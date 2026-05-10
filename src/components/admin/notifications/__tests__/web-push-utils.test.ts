import { describe, it, expect, vi } from "vitest";
import {
  arrayBufferToBase64Url,
  detectSupport,
  performSubscribe,
  performUnsubscribe,
  urlBase64ToUint8Array,
  type WebPushApi,
} from "../web-push-utils";

// PR 3 — UI utility tests. Project уже договорился (см. tests style для
// active-session-card): jsdom-инфра отсутствует, поэтому покрываем
// чистую логику helper'ов и оркестрацию через инъекции.
// DOM-уровень для WebPushOptIn — отдельный мини-PR (см. ADR § тесты).

describe("detectSupport", () => {
  it("returns 'unsupported' when navigator/window are undefined", () => {
    expect(detectSupport(undefined, undefined)).toBe("unsupported");
  });

  it("returns 'supported' when both serviceWorker and PushManager exist", () => {
    const nav = { userAgent: "Chrome", serviceWorker: {} } as unknown as Navigator;
    const win = { PushManager: function () {} } as unknown as Window;
    expect(detectSupport(nav, win)).toBe("supported");
  });

  it("returns 'ios_not_pwa' on iOS Safari without standalone", () => {
    const nav = {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Safari",
    } as unknown as Navigator;
    const win = {} as unknown as Window;
    expect(detectSupport(nav, win)).toBe("ios_not_pwa");
  });

  it("returns 'unsupported' on iOS Safari standalone but no PushManager (Safari < 16.4)", () => {
    const nav = {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X)",
      standalone: true,
    } as unknown as Navigator;
    const win = {} as unknown as Window;
    // standalone === true, но window.PushManager отсутствует → unsupported
    expect(detectSupport(nav, win)).toBe("unsupported");
  });

  it("returns 'unsupported' on non-iOS without serviceWorker", () => {
    const nav = { userAgent: "Mozilla Linux" } as unknown as Navigator;
    const win = {} as unknown as Window;
    expect(detectSupport(nav, win)).toBe("unsupported");
  });
});

describe("urlBase64ToUint8Array", () => {
  it("decodes a vapid-style base64url string", () => {
    // 'hello' = 'aGVsbG8' base64url, no padding
    const out = urlBase64ToUint8Array("aGVsbG8");
    expect(Array.from(out)).toEqual([104, 101, 108, 108, 111]);
  });

  it("handles padding correctly", () => {
    const out = urlBase64ToUint8Array("YQ"); // 'a' с двумя '='
    expect(Array.from(out)).toEqual([97]);
  });

  it("handles URL-safe characters - and _", () => {
    // Base64 of bytes [251, 255] = "+/8=" → URL-safe "-_8"
    const out = urlBase64ToUint8Array("-_8");
    expect(Array.from(out)).toEqual([251, 255]);
  });
});

describe("arrayBufferToBase64Url", () => {
  it("returns empty string for null", () => {
    expect(arrayBufferToBase64Url(null)).toBe("");
  });

  it("encodes bytes to base64url without padding", () => {
    const buf = new Uint8Array([104, 101, 108, 108, 111]).buffer;
    expect(arrayBufferToBase64Url(buf)).toBe("aGVsbG8");
  });

  it("uses URL-safe characters", () => {
    const buf = new Uint8Array([251, 255]).buffer;
    // base64: "+/8=" → url-safe "-_8"
    expect(arrayBufferToBase64Url(buf)).toBe("-_8");
  });
});

describe("performSubscribe", () => {
  function makeMocks(opts?: {
    permission?: NotificationPermission;
    publicKey?: string;
    endpoint?: string;
  }) {
    const api: WebPushApi = {
      getVapidPublicKey: vi.fn(async () => opts?.publicKey ?? "aGVsbG8"),
      postSubscribe: vi.fn(async () => undefined),
      deleteSubscribe: vi.fn(async () => undefined),
    };
    const fakeRegistration = { scope: "/" } as unknown as ServiceWorkerRegistration;
    const serviceWorker = {
      register: vi.fn(async () => fakeRegistration),
    } as unknown as ServiceWorkerContainer;
    const fakeSubscription = {
      endpoint:
        opts?.endpoint ??
        "https://fcm.googleapis.com/fcm/send/abc123",
      getKey: vi.fn((name: string) => {
        const data = name === "p256dh" ? [1, 2, 3] : [9, 8];
        return new Uint8Array(data).buffer;
      }),
    } as unknown as PushSubscription;
    const pushManagerSubscribe = vi.fn(async () => fakeSubscription);
    const requestPermission = vi.fn(async () => opts?.permission ?? "granted");
    return { api, serviceWorker, pushManagerSubscribe, requestPermission };
  }

  it("happy path: registers SW, gets key, subscribes, posts to API", async () => {
    const m = makeMocks();
    const result = await performSubscribe({
      api: m.api,
      serviceWorker: m.serviceWorker,
      pushManagerSubscribe: m.pushManagerSubscribe,
      requestPermission: m.requestPermission,
      userAgent: "TestUA/1.0",
    });

    expect(result.endpoint).toBe("https://fcm.googleapis.com/fcm/send/abc123");
    expect(m.requestPermission).toHaveBeenCalledOnce();
    expect((m.serviceWorker.register as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("/sw.js", { scope: "/" });
    expect(m.api.getVapidPublicKey).toHaveBeenCalledOnce();
    expect(m.pushManagerSubscribe).toHaveBeenCalledOnce();
    expect(m.api.postSubscribe).toHaveBeenCalledWith({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
      keys: { p256dh: "AQID", auth: "CQg" },
      userAgent: "TestUA/1.0",
    });
  });

  it("throws when permission is denied — does NOT call subscribe", async () => {
    const m = makeMocks({ permission: "denied" });
    await expect(
      performSubscribe({
        api: m.api,
        serviceWorker: m.serviceWorker,
        pushManagerSubscribe: m.pushManagerSubscribe,
        requestPermission: m.requestPermission,
      }),
    ).rejects.toThrow("permission:denied");
    expect(m.serviceWorker.register).not.toHaveBeenCalled();
    expect(m.api.postSubscribe).not.toHaveBeenCalled();
  });

  it("throws when permission is default (user closed prompt)", async () => {
    const m = makeMocks({ permission: "default" });
    await expect(
      performSubscribe({
        api: m.api,
        serviceWorker: m.serviceWorker,
        pushManagerSubscribe: m.pushManagerSubscribe,
        requestPermission: m.requestPermission,
      }),
    ).rejects.toThrow("permission:default");
  });

  it("propagates VAPID 503 error so UI can show 'disabled'", async () => {
    const m = makeMocks();
    (m.api.getVapidPublicKey as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("vapid-key:503"),
    );
    await expect(
      performSubscribe({
        api: m.api,
        serviceWorker: m.serviceWorker,
        pushManagerSubscribe: m.pushManagerSubscribe,
        requestPermission: m.requestPermission,
      }),
    ).rejects.toThrow("vapid-key:503");
  });
});

describe("performUnsubscribe", () => {
  it("returns alreadyUnsubscribed=true when no SW registration", async () => {
    const api: WebPushApi = {
      getVapidPublicKey: vi.fn(),
      postSubscribe: vi.fn(),
      deleteSubscribe: vi.fn(),
    };
    const sw = {
      getRegistration: vi.fn(async () => null),
    } as unknown as ServiceWorkerContainer;
    const result = await performUnsubscribe({ api, serviceWorker: sw });
    expect(result.alreadyUnsubscribed).toBe(true);
    expect(api.deleteSubscribe).not.toHaveBeenCalled();
  });

  it("returns alreadyUnsubscribed=true when no active subscription", async () => {
    const api: WebPushApi = {
      getVapidPublicKey: vi.fn(),
      postSubscribe: vi.fn(),
      deleteSubscribe: vi.fn(),
    };
    const reg = {
      pushManager: { getSubscription: vi.fn(async () => null) },
    } as unknown as ServiceWorkerRegistration;
    const sw = {
      getRegistration: vi.fn(async () => reg),
    } as unknown as ServiceWorkerContainer;
    const result = await performUnsubscribe({ api, serviceWorker: sw });
    expect(result.alreadyUnsubscribed).toBe(true);
  });

  it("unsubscribes locally and calls DELETE API on happy path", async () => {
    const api: WebPushApi = {
      getVapidPublicKey: vi.fn(),
      postSubscribe: vi.fn(),
      deleteSubscribe: vi.fn(async () => undefined),
    };
    const unsubscribe = vi.fn(async () => true);
    const sub = {
      endpoint: "https://fcm.googleapis.com/fcm/send/zz",
      unsubscribe,
    } as unknown as PushSubscription;
    const reg = {
      pushManager: { getSubscription: vi.fn(async () => sub) },
    } as unknown as ServiceWorkerRegistration;
    const sw = {
      getRegistration: vi.fn(async () => reg),
    } as unknown as ServiceWorkerContainer;

    const result = await performUnsubscribe({ api, serviceWorker: sw });
    expect(result.alreadyUnsubscribed).toBe(false);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(api.deleteSubscribe).toHaveBeenCalledWith(
      "https://fcm.googleapis.com/fcm/send/zz",
    );
  });
});
