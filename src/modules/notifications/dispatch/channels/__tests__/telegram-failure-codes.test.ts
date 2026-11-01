import { describe, it, expect } from "vitest";
import { classifyTelegramFailure } from "../telegram";

describe("classifyTelegramFailure (AC-E1.4, AC-D2.3)", () => {
  it.each([
    ["Forbidden: bot was blocked by the user", 403, "BOT_BLOCKED"],
    ["Forbidden: bot can't initiate conversation with a user", 403, "BOT_NOT_STARTED"],
    ["Bad Request: chat not found", 400, "BOT_NOT_STARTED"],
    ["Forbidden: user is deactivated", 403, "USER_DEACTIVATED"],
    ["Too Many Requests: retry after 5", 429, "NETWORK"],
    ["HTTP 502", 502, "NETWORK"],
    ["Bad Request: message is too long", 400, "OTHER"],
  ] as const)("%s → %s", (description, status, code) => {
    expect(classifyTelegramFailure(description, status)).toBe(code);
  });

  it("transport errors are NETWORK", () => {
    expect(classifyTelegramFailure("UND_ERR_CONNECT_TIMEOUT", undefined, true)).toBe("NETWORK");
  });
});
