import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { verifyCronRequest, safeCompare } from "../cron-auth";

function req(opts: { header?: string; query?: string } = {}) {
  const url = `http://localhost/api/cron/x${opts.query ? `?token=${opts.query}` : ""}`;
  const headers: Record<string, string> = opts.header ? { authorization: opts.header } : {};
  return new NextRequest(url, { method: "GET", headers });
}

describe("verifyCronRequest", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret-value";
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.AUTH_SECRET;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("пропускает верный Bearer", () => {
    expect(verifyCronRequest(req({ header: "Bearer cron-secret-value" }))).toBeNull();
  });

  it("503, если CRON_SECRET не задан, даже при NEXTAUTH_SECRET", async () => {
    delete process.env.CRON_SECRET;
    process.env.NEXTAUTH_SECRET = "auth";
    const res = verifyCronRequest(req({ header: "Bearer auth" }));
    expect(res?.status).toBe(503);
  });

  it("401 для ?token= без заголовка", () => {
    expect(verifyCronRequest(req({ query: "cron-secret-value" }))?.status).toBe(401);
  });

  it("401 для неверного, пустого и не-Bearer заголовка", () => {
    for (const header of ["Bearer wrong", "Bearer ", "cron-secret-value", "Basic cron-secret-value"]) {
      expect(verifyCronRequest(req({ header }))?.status).toBe(401);
    }
    expect(verifyCronRequest(req())?.status).toBe(401);
  });

  it("safeCompare: разная длина и префикс не совпадают", () => {
    expect(safeCompare("abc", "abc")).toBe(true);
    expect(safeCompare("abc", "abcd")).toBe(false);
    expect(safeCompare("", "abc")).toBe(false);
  });
});

describe("все cron-роуты используют verifyCronRequest", () => {
  const root = join(process.cwd(), "src/app/api/cron");
  const routes = readdirSync(root)
    .map((d) => join(root, d, "route.ts"))
    .filter((p) => existsSync(p));
  routes.push(join(process.cwd(), "src/app/api/ps-park/auto-complete/route.ts"));

  it("нашли cron-роуты", () => {
    expect(routes.length).toBeGreaterThanOrEqual(13);
  });

  it.each(routes)("%s", (path) => {
    const src = readFileSync(path, "utf8");
    expect(src).toContain("verifyCronRequest(request)");
    expect(src).not.toMatch(/searchParams\.get\(["']token["']\)/);
    expect(src).not.toContain("NEXTAUTH_SECRET");
  });
});
