import { describe, it, expect } from "vitest";
import {
  MAX_MESSAGE_LENGTH,
  MAX_META_LENGTH,
  MAX_REPORTS_PER_PAGE,
  buildClientErrorPayload,
  createReportLimiter,
  extractErrorMessage,
  isNoise,
} from "../client-error-beacon";

describe("isNoise", () => {
  it.each([
    "Script error.",
    "script error",
    "ResizeObserver loop completed with undelivered notifications.",
    "AbortError: The operation was aborted",
    "TypeError: Load failed",
    "NetworkError when attempting to fetch resource",
  ])("filters browser noise: %s", (msg) => {
    expect(isNoise(msg)).toBe(true);
  });

  it.each([
    "ChunkLoadError: Loading chunk 5 failed",
    "Failed to find Server Action",
    "TypeError: Cannot read properties of undefined",
  ])("keeps actionable errors: %s", (msg) => {
    expect(isNoise(msg)).toBe(false);
  });
});

describe("createReportLimiter", () => {
  it("caps reports per page", () => {
    const shouldReport = createReportLimiter(2);
    expect(shouldReport("error one")).toBe(true);
    expect(shouldReport("error two")).toBe(true);
    expect(shouldReport("error three")).toBe(false);
  });

  it("dedupes identical messages", () => {
    const shouldReport = createReportLimiter();
    expect(shouldReport("same")).toBe(true);
    expect(shouldReport("same")).toBe(false);
  });

  it("skips empty and noisy messages without consuming the budget", () => {
    const shouldReport = createReportLimiter(1);
    expect(shouldReport("")).toBe(false);
    expect(shouldReport("Script error.")).toBe(false);
    expect(shouldReport("real error")).toBe(true);
  });

  it("default cap equals MAX_REPORTS_PER_PAGE", () => {
    const shouldReport = createReportLimiter();
    for (let i = 0; i < MAX_REPORTS_PER_PAGE; i++) {
      expect(shouldReport(`err-${i}`)).toBe(true);
    }
    expect(shouldReport("one-more")).toBe(false);
  });
});

describe("buildClientErrorPayload", () => {
  it("truncates all fields to API limits", () => {
    const payload = buildClientErrorPayload(
      "m".repeat(600),
      "window-error",
      "u".repeat(400),
      "a".repeat(400),
    );
    expect(payload.message).toHaveLength(MAX_MESSAGE_LENGTH);
    expect(payload.url).toHaveLength(MAX_META_LENGTH);
    expect(payload.userAgent).toHaveLength(MAX_META_LENGTH);
  });

  it("omits absent optional fields", () => {
    const payload = buildClientErrorPayload("boom", "unhandled-rejection");
    expect(payload).toEqual({ message: "boom", source: "unhandled-rejection" });
  });
});

describe("extractErrorMessage", () => {
  it("prefers ErrorEvent.message", () => {
    expect(extractErrorMessage({ message: "boom" })).toBe("boom");
  });

  it("reads string and Error-like rejection reasons", () => {
    expect(extractErrorMessage({ reason: "ChunkLoadError" })).toBe("ChunkLoadError");
    expect(
      extractErrorMessage({
        reason: { name: "ChunkLoadError", message: "Loading chunk 5 failed" },
      }),
    ).toBe("ChunkLoadError: Loading chunk 5 failed");
  });

  it("returns empty string for unusable input", () => {
    expect(extractErrorMessage(null)).toBe("");
    expect(extractErrorMessage({ reason: 7 })).toBe("");
  });
});
