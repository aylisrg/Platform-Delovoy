import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { getCronBearerToken } from "../cron-auth";

const url = "http://localhost/api/cron/x";

describe("getCronBearerToken", () => {
  it("returns the Bearer token", () => {
    const req = new NextRequest(url, { headers: { authorization: "Bearer abc" } });
    expect(getCronBearerToken(req)).toBe("abc");
  });
  it("is case-insensitive on scheme", () => {
    const req = new NextRequest(url, { headers: { authorization: "bearer abc" } });
    expect(getCronBearerToken(req)).toBe("abc");
  });
  it("ignores ?token= query param", () => {
    expect(getCronBearerToken(new NextRequest(`${url}?token=abc`))).toBe("");
  });
  it("returns empty when header missing or not Bearer", () => {
    expect(getCronBearerToken(new NextRequest(url))).toBe("");
    const req = new NextRequest(url, { headers: { authorization: "Basic abc" } });
    expect(getCronBearerToken(req)).toBe("");
  });
});
