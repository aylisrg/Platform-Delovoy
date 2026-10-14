import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/modules/telephony/calls-sync", async (orig) => {
  const actual = await orig<typeof import("@/modules/telephony/calls-sync")>();
  return { ...actual, syncNovofonCalls: vi.fn() };
});

import { GET } from "../route";
import { NovofonApiError, syncNovofonCalls } from "@/modules/telephony/calls-sync";

const mockedSync = vi.mocked(syncNovofonCalls);
const req = (token?: string) =>
  new NextRequest("http://localhost/api/cron/novofon-calls-sync", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

describe("GET /api/cron/novofon-calls-sync", () => {
  const saved = process.env.CRON_SECRET;
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret";
    mockedSync.mockReset();
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (saved === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = saved;
  });

  it("без токена -> 401, синк не запускается", async () => {
    expect((await GET(req())).status).toBe(401);
    expect(mockedSync).not.toHaveBeenCalled();
  });

  it("неверный токен -> 401", async () => {
    expect((await GET(req("nope"))).status).toBe(401);
  });

  it("CRON_SECRET -> 200 и отчёт синка", async () => {
    mockedSync.mockResolvedValue({
      skipped: false, mode: "incremental", from: "a", till: "b", fetched: 3, upserted: 3, truncated: false,
    });
    const res = await GET(req("cron-secret"));
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).toContain('"upserted":3');
  });

  it("ошибка Novofon -> 500, в лог только код", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedSync.mockRejectedValue(new NovofonApiError(-32602, "x"));
    expect((await GET(req("cron-secret"))).status).toBe(500);
    expect(err.mock.calls.flat().join(" ")).toContain("code=-32602");
  });
});
