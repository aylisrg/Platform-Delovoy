import { describe, expect, it } from "vitest";
import { isWebPushEnabled, readVapidConfigFromEnv } from "../vapid";

const VALID_PUBLIC =
  "BJxQyKlF7sNqnG_1k0sM7G6yY3W4-r_lDxsRl6Hf-LhxN1AKr-MMSvEnX9YRs0aBcDe1xT_yU7B6oJyP0wRz3qg";
const VALID_PRIVATE = "abcdefghijklmnopqrstuvwxyz0123456789ABCD-_";

describe("readVapidConfigFromEnv", () => {
  it("returns null when public key missing", () => {
    const cfg = readVapidConfigFromEnv({
      VAPID_PRIVATE_KEY: VALID_PRIVATE,
      VAPID_SUBJECT: "mailto:admin@delovoy-park.ru",
    });
    expect(cfg).toBeNull();
  });

  it("returns null when keys contain invalid chars", () => {
    const cfg = readVapidConfigFromEnv({
      VAPID_PUBLIC_KEY: "BJxQyKlF7sNqnG/1k0sM7G6yY3W4+rlDxsRl6Hf",
      VAPID_PRIVATE_KEY: VALID_PRIVATE,
      VAPID_SUBJECT: "mailto:admin@delovoy-park.ru",
    });
    expect(cfg).toBeNull();
  });

  it("returns null when subject is plain string (no scheme)", () => {
    const cfg = readVapidConfigFromEnv({
      VAPID_PUBLIC_KEY: VALID_PUBLIC,
      VAPID_PRIVATE_KEY: VALID_PRIVATE,
      VAPID_SUBJECT: "admin@delovoy-park.ru",
    });
    expect(cfg).toBeNull();
  });

  it("accepts mailto: subject", () => {
    const cfg = readVapidConfigFromEnv({
      VAPID_PUBLIC_KEY: VALID_PUBLIC,
      VAPID_PRIVATE_KEY: VALID_PRIVATE,
      VAPID_SUBJECT: "mailto:admin@delovoy-park.ru",
    });
    expect(cfg).not.toBeNull();
    expect(cfg!.subject).toBe("mailto:admin@delovoy-park.ru");
  });

  it("accepts https:// subject", () => {
    const cfg = readVapidConfigFromEnv({
      VAPID_PUBLIC_KEY: VALID_PUBLIC,
      VAPID_PRIVATE_KEY: VALID_PRIVATE,
      VAPID_SUBJECT: "https://delovoy-park.ru",
    });
    expect(cfg).not.toBeNull();
  });

  it("falls back to VAPID_CONTACT_EMAIL and prepends mailto:", () => {
    const cfg = readVapidConfigFromEnv({
      VAPID_PUBLIC_KEY: VALID_PUBLIC,
      VAPID_PRIVATE_KEY: VALID_PRIVATE,
      VAPID_CONTACT_EMAIL: "admin@delovoy-park.ru",
    });
    expect(cfg).not.toBeNull();
    expect(cfg!.subject).toBe("mailto:admin@delovoy-park.ru");
  });
});

describe("isWebPushEnabled", () => {
  const validEnv = {
    WEB_PUSH_ENABLED: "true",
    VAPID_PUBLIC_KEY: VALID_PUBLIC,
    VAPID_PRIVATE_KEY: VALID_PRIVATE,
    VAPID_SUBJECT: "mailto:admin@delovoy-park.ru",
  };

  it("false when flag not set", () => {
    expect(isWebPushEnabled({ ...validEnv, WEB_PUSH_ENABLED: undefined })).toBe(false);
  });

  it("false when flag is 'false'", () => {
    expect(isWebPushEnabled({ ...validEnv, WEB_PUSH_ENABLED: "false" })).toBe(false);
  });

  it("false when flag set but VAPID missing", () => {
    expect(
      isWebPushEnabled({
        WEB_PUSH_ENABLED: "true",
      }),
    ).toBe(false);
  });

  it("true with full valid config", () => {
    expect(isWebPushEnabled(validEnv)).toBe(true);
  });
});
