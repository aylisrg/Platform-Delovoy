import { describe, it, expect } from "vitest";
import {
  generatePublicId,
  parsePublicId,
  isPublicId,
  PUBLIC_ID_ALPHABET,
} from "../public-id";

describe("generatePublicId", () => {
  it("matches TASK-XXXXX format", () => {
    for (let i = 0; i < 50; i++) {
      const id = generatePublicId();
      expect(id).toMatch(/^TASK-[2-9A-Z]{5}$/);
    }
  });

  it("uses only the safe alphabet (no 0, 1, I, O)", () => {
    for (let i = 0; i < 200; i++) {
      const body = generatePublicId().slice(5);
      for (const ch of body) {
        expect(PUBLIC_ID_ALPHABET).toContain(ch);
        expect(["0", "1", "I", "O"]).not.toContain(ch);
      }
    }
  });

  it("produces varied output over repeated calls", () => {
    const set = new Set<string>();
    for (let i = 0; i < 100; i++) set.add(generatePublicId());
    // 32^5 ≈ 33M — collisions in 100 tries are astronomically unlikely
    expect(set.size).toBe(100);
  });
});

describe("parsePublicId", () => {
  it("extracts id from an email subject prefix", () => {
    expect(parsePublicId("[TASK-ABCDE] Протечка в санузле")).toBe("TASK-ABCDE");
  });

  it("extracts id from a reply subject", () => {
    expect(parsePublicId("Re: Неисправность [TASK-K7H3Q]")).toBe("TASK-K7H3Q");
  });

  it("extracts id from lowercase input", () => {
    expect(parsePublicId("re: task-abcde")).toBe("TASK-ABCDE");
  });

  it("returns null when no id present", () => {
    expect(parsePublicId("Просто письмо без айди")).toBeNull();
    expect(parsePublicId("TASK-")).toBeNull();
    expect(parsePublicId("TASK-123")).toBeNull(); // contains ambiguous digit
    expect(parsePublicId("")).toBeNull();
  });

  it("rejects ids using forbidden characters", () => {
    // 'O' and '0' are not in the alphabet — must not match
    expect(parsePublicId("TASK-OOOOO")).toBeNull();
    expect(parsePublicId("TASK-00000")).toBeNull();
    expect(parsePublicId("TASK-IIIII")).toBeNull();
  });
});

describe("isPublicId", () => {
  it("accepts canonical ids", () => {
    expect(isPublicId("TASK-ABCDE")).toBe(true);
    expect(isPublicId("TASK-K7H3Q")).toBe(true);
    expect(isPublicId("TASK-23456")).toBe(true);
  });

  it("rejects surrounding text", () => {
    expect(isPublicId("[TASK-ABCDE]")).toBe(false);
    expect(isPublicId("TASK-ABCDE ")).toBe(false);
  });

  it("rejects wrong length / charset", () => {
    expect(isPublicId("TASK-ABC")).toBe(false);
    expect(isPublicId("TASK-ABCDEF")).toBe(false);
    expect(isPublicId("TASK-ABCD0")).toBe(false);
    expect(isPublicId("task-abcde")).toBe(false); // case sensitive
  });
});
