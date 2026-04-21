import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isStaging,
  checkStagingBasicAuth,
  enforceStagingBasicAuth,
  isStagingPublicPath,
} from "../staging-guard";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "");
  vi.stubEnv("NEXT_PUBLIC_ENV", "");
  vi.stubEnv("STAGING_LOCKDOWN", "");
  vi.stubEnv("STAGING_BASIC_AUTH_USER", "");
  vi.stubEnv("STAGING_BASIC_AUTH_PASS", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isStaging", () => {
  it("returns false when no staging env is set", () => {
    expect(isStaging()).toBe(false);
  });

  it("returns true when NODE_ENV=staging", () => {
    vi.stubEnv("NODE_ENV", "staging");
    expect(isStaging()).toBe(true);
  });

  it("returns true when NEXT_PUBLIC_ENV=staging", () => {
    vi.stubEnv("NEXT_PUBLIC_ENV", "staging");
    expect(isStaging()).toBe(true);
  });

  it("returns true when STAGING_LOCKDOWN=true", () => {
    vi.stubEnv("STAGING_LOCKDOWN", "true");
    expect(isStaging()).toBe(true);
  });

  it("returns false when NODE_ENV=production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isStaging()).toBe(false);
  });
});

describe("checkStagingBasicAuth", () => {
  it("returns ok when credentials are not configured", () => {
    expect(checkStagingBasicAuth("Basic anything").ok).toBe(true);
  });

  it("returns missing when no header and creds configured", () => {
    vi.stubEnv("STAGING_BASIC_AUTH_USER", "u");
    vi.stubEnv("STAGING_BASIC_AUTH_PASS", "p");
    const r = checkStagingBasicAuth(null);
    expect(r).toEqual({ ok: false, reason: "missing" });
  });

  it("returns invalid on malformed header", () => {
    vi.stubEnv("STAGING_BASIC_AUTH_USER", "u");
    vi.stubEnv("STAGING_BASIC_AUTH_PASS", "p");
    const r = checkStagingBasicAuth("Bearer token");
    expect(r).toEqual({ ok: false, reason: "missing" });
  });

  it("returns invalid on wrong password", () => {
    vi.stubEnv("STAGING_BASIC_AUTH_USER", "staging");
    vi.stubEnv("STAGING_BASIC_AUTH_PASS", "secret");
    const header = `Basic ${Buffer.from("staging:wrong").toString("base64")}`;
    const r = checkStagingBasicAuth(header);
    expect(r.ok).toBe(false);
  });

  it("returns ok on correct credentials", () => {
    vi.stubEnv("STAGING_BASIC_AUTH_USER", "staging");
    vi.stubEnv("STAGING_BASIC_AUTH_PASS", "secret");
    const header = `Basic ${Buffer.from("staging:secret").toString("base64")}`;
    const r = checkStagingBasicAuth(header);
    expect(r.ok).toBe(true);
  });

  it("returns invalid on base64-garbled value", () => {
    vi.stubEnv("STAGING_BASIC_AUTH_USER", "u");
    vi.stubEnv("STAGING_BASIC_AUTH_PASS", "p");
    const r = checkStagingBasicAuth("Basic !!!not-base64!!!");
    expect(r.ok).toBe(false);
  });
});

describe("isStagingPublicPath", () => {
  it("allows /api/health", () => {
    expect(isStagingPublicPath("/api/health")).toBe(true);
  });

  it("allows static assets", () => {
    expect(isStagingPublicPath("/_next/static/chunks/x.js")).toBe(true);
  });

  it("rejects app routes", () => {
    expect(isStagingPublicPath("/admin/dashboard")).toBe(false);
    expect(isStagingPublicPath("/cafe")).toBe(false);
  });
});

describe("enforceStagingBasicAuth", () => {
  function makeRequest(pathname: string, auth?: string) {
    const headers = new Headers();
    if (auth) headers.set("authorization", auth);
    return { headers, nextUrl: { pathname } };
  }

  it("is a no-op off-staging", () => {
    const res = enforceStagingBasicAuth(makeRequest("/admin/dashboard"));
    expect(res).toBeNull();
  });

  it("allows /api/health on staging without auth", () => {
    vi.stubEnv("NODE_ENV", "staging");
    vi.stubEnv("STAGING_BASIC_AUTH_USER", "u");
    vi.stubEnv("STAGING_BASIC_AUTH_PASS", "p");
    const res = enforceStagingBasicAuth(makeRequest("/api/health"));
    expect(res).toBeNull();
  });

  it("challenges unauth request on staging", () => {
    vi.stubEnv("NODE_ENV", "staging");
    vi.stubEnv("STAGING_BASIC_AUTH_USER", "u");
    vi.stubEnv("STAGING_BASIC_AUTH_PASS", "p");
    const res = enforceStagingBasicAuth(makeRequest("/admin/dashboard"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
    expect(res!.headers.get("WWW-Authenticate")).toMatch(/Basic/);
  });

  it("accepts valid auth on staging", () => {
    vi.stubEnv("NODE_ENV", "staging");
    vi.stubEnv("STAGING_BASIC_AUTH_USER", "u");
    vi.stubEnv("STAGING_BASIC_AUTH_PASS", "p");
    const header = `Basic ${Buffer.from("u:p").toString("base64")}`;
    const res = enforceStagingBasicAuth(makeRequest("/admin/dashboard", header));
    expect(res).toBeNull();
  });
});
