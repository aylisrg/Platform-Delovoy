import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { safeCompare, verifyCronRequest, verifyLegacyCronRequest } from "@/lib/cron-auth";

const CRON = "cron-secret-test-value";
const NEXTAUTH = "nextauth-secret-test-value";

function req(auth?: string) {
  const headers: Record<string, string> = {};
  if (auth !== undefined) headers.authorization = auth;
  return new NextRequest("http://localhost/api/cron/x", { headers });
}

describe("safeCompare", () => {
  it("равные строки", () => expect(safeCompare("abc", "abc")).toBe(true));
  it("разные строки одной длины", () => expect(safeCompare("abc", "abd")).toBe(false));
  it("разная длина", () => expect(safeCompare("abc", "abcd")).toBe(false));
  it("пустая против непустой", () => expect(safeCompare("", "abc")).toBe(false));
});

describe("verifyCronRequest", () => {
  const saved = { c: process.env.CRON_SECRET, n: process.env.NEXTAUTH_SECRET };
  beforeEach(() => {
    process.env.CRON_SECRET = CRON;
    process.env.NEXTAUTH_SECRET = NEXTAUTH;
  });
  afterEach(() => {
    if (saved.c === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = saved.c;
    if (saved.n === undefined) delete process.env.NEXTAUTH_SECRET; else process.env.NEXTAUTH_SECRET = saved.n;
  });

  it("верный Bearer CRON_SECRET -> null (ok)", () => {
    expect(verifyCronRequest(req(`Bearer ${CRON}`))).toBeNull();
  });
  it("неверный токен -> 401", () => {
    expect(verifyCronRequest(req("Bearer wrong"))?.status).toBe(401);
  });
  it("без заголовка -> 401", () => {
    expect(verifyCronRequest(req())?.status).toBe(401);
  });
  it("NEXTAUTH_SECRET как Bearer при заданном CRON_SECRET -> 401", () => {
    expect(verifyCronRequest(req(`Bearer ${NEXTAUTH}`))?.status).toBe(401);
  });
  it("CRON_SECRET не задан -> 503, даже если NEXTAUTH_SECRET задан", () => {
    delete process.env.CRON_SECRET;
    expect(verifyCronRequest(req(`Bearer ${NEXTAUTH}`))?.status).toBe(503);
    expect(verifyCronRequest(req())?.status).toBe(503);
  });
  it("?token= не принимается", () => {
    const r = new NextRequest(`http://localhost/api/cron/x?token=${CRON}`);
    expect(verifyCronRequest(r)?.status).toBe(401);
  });
});

describe("verifyLegacyCronRequest (переходный режим #1084, avito/inventory)", () => {
  const saved = { c: process.env.CRON_SECRET, n: process.env.NEXTAUTH_SECRET };
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    process.env.CRON_SECRET = CRON;
    process.env.NEXTAUTH_SECRET = NEXTAUTH;
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    if (saved.c === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = saved.c;
    if (saved.n === undefined) delete process.env.NEXTAUTH_SECRET; else process.env.NEXTAUTH_SECRET = saved.n;
  });

  it("CRON_SECRET -> ok без предупреждения", () => {
    expect(verifyLegacyCronRequest(req(`Bearer ${CRON}`), "inventory")).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
  it("NEXTAUTH_SECRET -> ok, warn с именем маршрута и без значения секрета", () => {
    expect(verifyLegacyCronRequest(req(`Bearer ${NEXTAUTH}`), "avito-stats-sync")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = warn.mock.calls.flat().map(String).join(" ");
    expect(msg).toContain("avito-stats-sync");
    expect(msg).not.toContain(NEXTAUTH);
    expect(msg).not.toContain(CRON);
  });
  it("NEXTAUTH_SECRET при незаданном CRON_SECRET -> ok", () => {
    delete process.env.CRON_SECRET;
    expect(verifyLegacyCronRequest(req(`Bearer ${NEXTAUTH}`), "inventory")).toBeNull();
  });
  it("неверный токен -> 401, без warn", () => {
    expect(verifyLegacyCronRequest(req("Bearer wrong"), "inventory")?.status).toBe(401);
    expect(warn).not.toHaveBeenCalled();
  });
  it("без заголовка -> 401", () => {
    expect(verifyLegacyCronRequest(req(), "inventory")?.status).toBe(401);
  });
  it("NEXTAUTH_SECRET не задан: его прежнее значение не принимается", () => {
    delete process.env.NEXTAUTH_SECRET;
    expect(verifyLegacyCronRequest(req(`Bearer ${NEXTAUTH}`), "inventory")?.status).toBe(401);
  });
  it("оба не заданы -> 503", () => {
    delete process.env.CRON_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    expect(verifyLegacyCronRequest(req("Bearer x"), "inventory")?.status).toBe(503);
  });
  it("остальные cron (verifyCronRequest) NEXTAUTH_SECRET не принимают и не пишут warn", () => {
    expect(verifyCronRequest(req(`Bearer ${NEXTAUTH}`))?.status).toBe(401);
    expect(warn).not.toHaveBeenCalled();
  });
});
