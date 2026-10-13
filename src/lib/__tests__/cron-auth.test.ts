import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { safeCompare, verifyCronRequest } from "@/lib/cron-auth";

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
