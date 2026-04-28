import { describe, it, expect } from "vitest";
import { normalizePhone } from "../phone";

describe("normalizePhone", () => {
  describe("valid Russian mobile inputs", () => {
    it("accepts +7 prefixed canonical form", () => {
      expect(normalizePhone("+79001234567")).toBe("+79001234567");
    });

    it("accepts 8-prefixed and converts to +7", () => {
      expect(normalizePhone("89001234567")).toBe("+79001234567");
    });

    it("accepts 7-prefixed without plus and adds plus", () => {
      expect(normalizePhone("79001234567")).toBe("+79001234567");
    });

    it("accepts bare 10-digit and prepends +7", () => {
      expect(normalizePhone("9001234567")).toBe("+79001234567");
    });

    it("strips spaces", () => {
      expect(normalizePhone("+7 900 123 45 67")).toBe("+79001234567");
    });

    it("strips parentheses and dashes", () => {
      expect(normalizePhone("8(900)123-45-67")).toBe("+79001234567");
    });

    it("strips dots", () => {
      expect(normalizePhone("+7.900.123.45.67")).toBe("+79001234567");
    });

    it("trims surrounding whitespace", () => {
      expect(normalizePhone("   +79001234567   ")).toBe("+79001234567");
    });

    it("accepts mixed garbage but real digits", () => {
      expect(normalizePhone("phone: 8 (900) 123-45-67 ext.")).toBe(
        "+79001234567"
      );
    });
  });

  describe("invalid inputs", () => {
    it("rejects null", () => {
      expect(normalizePhone(null)).toBeNull();
    });

    it("rejects undefined", () => {
      expect(normalizePhone(undefined)).toBeNull();
    });

    it("rejects empty string", () => {
      expect(normalizePhone("")).toBeNull();
    });

    it("rejects whitespace-only string", () => {
      expect(normalizePhone("   ")).toBeNull();
    });

    it("rejects too-short input", () => {
      expect(normalizePhone("123")).toBeNull();
    });

    it("rejects too-long input", () => {
      expect(normalizePhone("89001234567890")).toBeNull();
    });

    it("rejects non-Russian +1 (US)", () => {
      expect(normalizePhone("+15551234567")).toBeNull();
    });

    it("rejects landline (RU 4XX)", () => {
      // Russian landlines start with 4 after the country code; auto-merge
      // only matches mobile numbers (Telegram requestContact returns mobile).
      expect(normalizePhone("+74951234567")).toBeNull();
    });

    it("rejects 10 digits not starting with 9", () => {
      expect(normalizePhone("4951234567")).toBeNull();
    });

    it("rejects only non-digit characters", () => {
      expect(normalizePhone("+++---()")).toBeNull();
    });

    it("rejects non-string input gracefully", () => {
      // TS guards this at compile time, but the runtime path is defensive.
      expect(normalizePhone(123 as unknown as string)).toBeNull();
    });
  });
});
