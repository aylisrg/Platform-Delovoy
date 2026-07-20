import { describe, it, expect } from "vitest";
import {
  RELOAD_COOLDOWN_MS,
  RELOAD_GUARD_KEY,
  extractErrorMessage,
  isStaleBundleError,
  shouldReload,
} from "../chunk-reload";

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

describe("isStaleBundleError", () => {
  it.each([
    "ChunkLoadError: Loading chunk 523 failed.",
    "Loading chunk app-pages-internals failed (timeout)",
    "Loading CSS chunk 12 failed",
    "TypeError: Failed to fetch dynamically imported module: https://x/_next/static/chunks/a.js",
    "error loading dynamically imported module",
    'Failed to find Server Action "abc123". This request might be from an older or newer deployment.',
  ])("matches stale-bundle error: %s", (msg) => {
    expect(isStaleBundleError(msg)).toBe(true);
  });

  it.each([
    "TypeError: Cannot read properties of undefined",
    "NetworkError when attempting to fetch resource",
    "",
    undefined,
    null,
    42,
  ])("ignores unrelated input: %s", (msg) => {
    expect(isStaleBundleError(msg)).toBe(false);
  });
});

describe("shouldReload", () => {
  it("allows first reload and stamps the guard", () => {
    const storage = memoryStorage();
    expect(shouldReload(storage, 1_000_000)).toBe(true);
    expect(storage.getItem(RELOAD_GUARD_KEY)).toBe("1000000");
  });

  it("blocks a second reload within the cooldown", () => {
    const storage = memoryStorage();
    expect(shouldReload(storage, 1_000_000)).toBe(true);
    expect(shouldReload(storage, 1_000_000 + RELOAD_COOLDOWN_MS - 1)).toBe(false);
  });

  it("allows reload again after the cooldown", () => {
    const storage = memoryStorage();
    expect(shouldReload(storage, 1_000_000)).toBe(true);
    expect(shouldReload(storage, 1_000_000 + RELOAD_COOLDOWN_MS)).toBe(true);
  });

  it("treats garbage in storage as no previous reload", () => {
    const storage = memoryStorage({ [RELOAD_GUARD_KEY]: "not-a-number" });
    expect(shouldReload(storage, 5)).toBe(true);
  });

  it("returns false when storage throws (private mode)", () => {
    const storage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(shouldReload(storage, 1_000_000)).toBe(false);
  });
});

describe("extractErrorMessage", () => {
  it("prefers ErrorEvent.message", () => {
    expect(extractErrorMessage({ message: "boom" })).toBe("boom");
  });

  it("reads string rejection reason", () => {
    expect(extractErrorMessage({ reason: "ChunkLoadError" })).toBe("ChunkLoadError");
  });

  it("joins name and message of an Error-like reason", () => {
    expect(
      extractErrorMessage({
        reason: { name: "ChunkLoadError", message: "Loading chunk 5 failed" },
      }),
    ).toBe("ChunkLoadError: Loading chunk 5 failed");
  });

  it("returns empty string for unusable input", () => {
    expect(extractErrorMessage(null)).toBe("");
    expect(extractErrorMessage("plain")).toBe("");
    expect(extractErrorMessage({ reason: 7 })).toBe("");
  });
});
