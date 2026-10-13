import { describe, it, expect } from "vitest";
import { getNovofonCallApiToken, getNovofonDataApiToken } from "../novofon-client";

describe("Novofon token env resolution", () => {
  it("prefers dedicated tokens", () => {
    const env = { NOVOFON_DATA_API_TOKEN: "d", NOVOFON_CALL_API_TOKEN: "c", NOVOFON_API_TOKEN: "x" } as unknown as NodeJS.ProcessEnv;
    expect(getNovofonDataApiToken(env)).toBe("d");
    expect(getNovofonCallApiToken(env)).toBe("c");
  });
  it("falls back to NOVOFON_API_TOKEN then NOVOFON_API_KEY", () => {
    expect(getNovofonDataApiToken({ NOVOFON_API_TOKEN: "x" } as unknown as NodeJS.ProcessEnv)).toBe("x");
    expect(getNovofonCallApiToken({ NOVOFON_API_KEY: "k" } as unknown as NodeJS.ProcessEnv)).toBe("k");
    expect(getNovofonCallApiToken({} as unknown as NodeJS.ProcessEnv)).toBe("");
  });
});
