import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn().mockResolvedValue(null),
}));

import { GET } from "../route";

const VALID_PUB =
  "BPzS3w7m9eWWyqL0kU7-VhJxIv6dTeHJ3kK9fOaTYz5XoEN3hbcdvIwZ4n7QqlQ8aS6_xY9KZUq2H8eGfX1jLhM";
const VALID_PRIV = "k6n8Q3nYx_z2fYqXnTpRbGeUu9MjOoP1qAwS3Vd5Hjk";

function makeReq(): NextRequest {
  return {
    headers: { get: () => "127.0.0.1" },
    nextUrl: new URL("http://localhost/api/notifications/web-push/vapid-public-key"),
  } as unknown as NextRequest;
}

describe("GET /api/notifications/web-push/vapid-public-key", () => {
  const ORIGINAL = { ...process.env };

  beforeEach(() => {
    process.env = { ...ORIGINAL };
  });

  afterEach(() => {
    process.env = ORIGINAL;
    vi.clearAllMocks();
  });

  it("happy path: returns publicKey when WEB_PUSH_ENABLED and ключи настроены", async () => {
    process.env.WEB_PUSH_ENABLED = "true";
    process.env.VAPID_PUBLIC_KEY = VALID_PUB;
    process.env.VAPID_PRIVATE_KEY = VALID_PRIV;
    process.env.VAPID_SUBJECT = "mailto:admin@delovoy-park.ru";
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = VALID_PUB;

    const res = await GET(makeReq());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.publicKey).toBe(VALID_PUB);
  });

  it("503 when WEB_PUSH_ENABLED=false", async () => {
    process.env.WEB_PUSH_ENABLED = "false";
    process.env.VAPID_PUBLIC_KEY = VALID_PUB;
    process.env.VAPID_PRIVATE_KEY = VALID_PRIV;
    process.env.VAPID_SUBJECT = "mailto:admin@delovoy-park.ru";
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = VALID_PUB;

    const res = await GET(makeReq());
    const json = await res.json();

    expect(res.status).toBe(503);
    expect(json.success).toBe(false);
    expect(json.error.code).toBe("WEB_PUSH_DISABLED");
  });

  it("503 when VAPID_PUBLIC_KEY missing", async () => {
    process.env.WEB_PUSH_ENABLED = "true";
    delete process.env.VAPID_PUBLIC_KEY;
    process.env.VAPID_PRIVATE_KEY = VALID_PRIV;
    process.env.VAPID_SUBJECT = "mailto:admin@delovoy-park.ru";
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

    const res = await GET(makeReq());

    expect(res.status).toBe(503);
  });
});
