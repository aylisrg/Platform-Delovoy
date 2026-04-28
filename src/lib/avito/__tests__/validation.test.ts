import { describe, it, expect } from "vitest";
import {
  AvitoItemAssignSchema,
  AvitoItemsQuerySchema,
  AvitoStatsQuerySchema,
  AvitoReplySchema,
} from "../validation";

describe("AvitoItemAssignSchema", () => {
  it("accepts gazebos and ps-park", () => {
    expect(AvitoItemAssignSchema.parse({ moduleSlug: "gazebos" })).toEqual({ moduleSlug: "gazebos" });
    expect(AvitoItemAssignSchema.parse({ moduleSlug: "ps-park" })).toEqual({ moduleSlug: "ps-park" });
  });

  it("accepts null (clear assignment)", () => {
    expect(AvitoItemAssignSchema.parse({ moduleSlug: null })).toEqual({ moduleSlug: null });
  });

  it("rejects unknown modules", () => {
    expect(() => AvitoItemAssignSchema.parse({ moduleSlug: "cafe" })).toThrow();
    expect(() => AvitoItemAssignSchema.parse({ moduleSlug: "" })).toThrow();
  });
});

describe("AvitoItemsQuerySchema", () => {
  it("defaults period to 7d", () => {
    expect(AvitoItemsQuerySchema.parse({})).toEqual({ period: "7d" });
  });

  it("accepts moduleSlug=all|none and module slugs", () => {
    expect(AvitoItemsQuerySchema.parse({ moduleSlug: "all" }).moduleSlug).toBe("all");
    expect(AvitoItemsQuerySchema.parse({ moduleSlug: "none" }).moduleSlug).toBe("none");
    expect(AvitoItemsQuerySchema.parse({ moduleSlug: "gazebos" }).moduleSlug).toBe("gazebos");
  });
});

describe("AvitoStatsQuerySchema", () => {
  it("rejects unknown periods", () => {
    expect(() => AvitoStatsQuerySchema.parse({ period: "1d" })).toThrow();
  });
});

describe("AvitoReplySchema", () => {
  it("requires non-empty text", () => {
    expect(() => AvitoReplySchema.parse({ text: "" })).toThrow();
  });

  it("rejects > 2000 chars", () => {
    expect(() => AvitoReplySchema.parse({ text: "a".repeat(2001) })).toThrow();
  });
});
