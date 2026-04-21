import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isStaging,
  checkStagingBasicAuth,
  enforceStagingBasicAuth,
  enforceStagingRoleCheck,
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

describe("enforceStagingRoleCheck", () => {
  function req(method: string, pathname: string) {
    return { method, nextUrl: { pathname } };
  }

  it("is a no-op off-staging even for USER POST", () => {
    const session = { user: { id: "u1", role: "USER" } };
    expect(enforceStagingRoleCheck(req("POST", "/api/cafe/order"), session)).toBeNull();
  });

  it("blocks USER POST /api/cafe/order on staging with 403 STAGING_READ_ONLY", async () => {
    vi.stubEnv("NODE_ENV", "staging");
    const session = { user: { id: "u1", role: "USER" } };
    const res = enforceStagingRoleCheck(req("POST", "/api/cafe/order"), session);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const body = await res!.json();
    expect(body).toEqual({
      success: false,
      error: {
        code: "STAGING_READ_ONLY",
        message: "Staging доступен только SUPERADMIN для изменений",
      },
    });
  });

  it("blocks MANAGER POST /api/gazebos/book on staging", () => {
    vi.stubEnv("NODE_ENV", "staging");
    const session = { user: { id: "m1", role: "MANAGER" } };
    const res = enforceStagingRoleCheck(req("POST", "/api/gazebos/book"), session);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it("blocks ADMIN DELETE on staging (не SUPERADMIN)", () => {
    vi.stubEnv("NODE_ENV", "staging");
    const session = { user: { id: "a1", role: "ADMIN" } };
    const res = enforceStagingRoleCheck(req("DELETE", "/api/cafe/menu/123"), session);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it("blocks anonymous POST on staging", () => {
    vi.stubEnv("NODE_ENV", "staging");
    const res = enforceStagingRoleCheck(req("POST", "/api/cafe/order"), null);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it("allows SUPERADMIN POST /api/admin/backups/restore on staging", () => {
    vi.stubEnv("NODE_ENV", "staging");
    const session = { user: { id: "s1", role: "SUPERADMIN" } };
    const res = enforceStagingRoleCheck(
      req("POST", "/api/admin/backups/restore"),
      session
    );
    expect(res).toBeNull();
  });

  it("allows SUPERADMIN PATCH and PUT on staging", () => {
    vi.stubEnv("NODE_ENV", "staging");
    const session = { user: { id: "s1", role: "SUPERADMIN" } };
    expect(
      enforceStagingRoleCheck(req("PATCH", "/api/cafe/menu/1"), session)
    ).toBeNull();
    expect(
      enforceStagingRoleCheck(req("PUT", "/api/cafe/menu/1"), session)
    ).toBeNull();
  });

  it("allows any role GET /api/cafe on staging (read-only)", () => {
    vi.stubEnv("NODE_ENV", "staging");
    expect(
      enforceStagingRoleCheck(req("GET", "/api/cafe"), { user: { role: "USER" } })
    ).toBeNull();
    expect(
      enforceStagingRoleCheck(req("GET", "/api/cafe"), { user: { role: "MANAGER" } })
    ).toBeNull();
    expect(enforceStagingRoleCheck(req("GET", "/api/cafe"), null)).toBeNull();
  });

  it("allows HEAD/OPTIONS on staging for any role", () => {
    vi.stubEnv("NODE_ENV", "staging");
    const session = { user: { role: "USER" } };
    expect(enforceStagingRoleCheck(req("HEAD", "/api/cafe"), session)).toBeNull();
    expect(enforceStagingRoleCheck(req("OPTIONS", "/api/cafe"), session)).toBeNull();
  });

  it("whitelists POST /api/auth/signin for any role", () => {
    vi.stubEnv("NODE_ENV", "staging");
    expect(
      enforceStagingRoleCheck(req("POST", "/api/auth/signin"), null)
    ).toBeNull();
    expect(
      enforceStagingRoleCheck(
        req("POST", "/api/auth/callback/credentials"),
        { user: { role: "USER" } }
      )
    ).toBeNull();
  });

  it("whitelists POST /api/health on staging", () => {
    vi.stubEnv("NODE_ENV", "staging");
    expect(
      enforceStagingRoleCheck(req("POST", "/api/health"), null)
    ).toBeNull();
  });

  it("is a no-op in production for USER POST", () => {
    vi.stubEnv("NODE_ENV", "production");
    const session = { user: { role: "USER" } };
    expect(
      enforceStagingRoleCheck(req("POST", "/api/cafe/order"), session)
    ).toBeNull();
  });
});
