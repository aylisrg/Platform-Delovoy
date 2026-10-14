import { describe, it, expect } from "vitest";
import { getNovofonCallApiToken, getNovofonDataApiToken } from "../novofon-client";

const asEnv = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;

describe("Novofon token env resolution", () => {
  it("uses the single NOVOFON_API_TOKEN for both Call and Data API", () => {
    const env = asEnv({ NOVOFON_API_TOKEN: "x", NOVOFON_DATA_API_TOKEN: "d", NOVOFON_CALL_API_TOKEN: "c" });
    expect(getNovofonDataApiToken(env)).toBe("x");
    expect(getNovofonCallApiToken(env)).toBe("x");
  });
  it("falls back to dedicated tokens when NOVOFON_API_TOKEN is not set", () => {
    const env = asEnv({ NOVOFON_DATA_API_TOKEN: "d", NOVOFON_CALL_API_TOKEN: "c" });
    expect(getNovofonDataApiToken(env)).toBe("d");
    expect(getNovofonCallApiToken(env)).toBe("c");
  });
  it("falls back to legacy NOVOFON_API_KEY, then empty", () => {
    expect(getNovofonCallApiToken(asEnv({ NOVOFON_API_KEY: "k" }))).toBe("k");
    expect(getNovofonDataApiToken(asEnv({ NOVOFON_API_KEY: "k" }))).toBe("k");
    expect(getNovofonCallApiToken(asEnv({}))).toBe("");
  });
});
