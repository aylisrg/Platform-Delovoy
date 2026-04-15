import { describe, it, expect } from "vitest";
import { ADMIN_HINTS } from "@/lib/admin-hints";

describe("admin-hints", () => {
  it("has hints for all major admin sections", () => {
    const requiredSections = [
      "dashboard",
      "gazebos",
      "ps-park",
      "cafe",
      "rental",
      "clients",
      "users",
      "monitoring",
      "feedback",
    ];
    for (const section of requiredSections) {
      expect(ADMIN_HINTS[section]).toBeDefined();
      expect(ADMIN_HINTS[section].hints.length).toBeGreaterThan(0);
    }
  });

  it("all hints have non-empty title and text", () => {
    for (const [slug, section] of Object.entries(ADMIN_HINTS)) {
      expect(section.sectionTitle).toBeTruthy();
      for (const hint of section.hints) {
        expect(hint.title, `${slug} hint missing title`).toBeTruthy();
        expect(hint.text, `${slug} hint missing text`).toBeTruthy();
      }
    }
  });

  it("all section titles are non-empty strings", () => {
    for (const section of Object.values(ADMIN_HINTS)) {
      expect(typeof section.sectionTitle).toBe("string");
      expect(section.sectionTitle.length).toBeGreaterThan(0);
    }
  });

  it("ps-park hints include slot rounding explanation", () => {
    const psParkHints = ADMIN_HINTS["ps-park"];
    expect(psParkHints).toBeDefined();
    const slotHint = psParkHints.hints.find((h) =>
      h.title.toLowerCase().includes("округлен")
    );
    expect(slotHint).toBeDefined();
    expect(slotHint?.text).toContain("30");
  });
});
