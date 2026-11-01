import { describe, it, expect } from "vitest";
import {
  mergeExecuteSchema,
  mergePairSchema,
  mergeRequestActionSchema,
  mergeRequestsQuerySchema,
  mergeSearchQuerySchema,
  SAME_ACCOUNT_MESSAGE,
} from "../merge-validation";

/** Zod contracts of the merge API — ADR 2026-10-25 §6.2. */

describe("mergeSearchQuerySchema", () => {
  it("trims, needs 2–100 chars", () => {
    expect(mergeSearchQuerySchema.parse({ q: "  ив  " })).toEqual({ q: "ив" });
    expect(mergeSearchQuerySchema.safeParse({ q: "и" }).success).toBe(false);
    expect(mergeSearchQuerySchema.safeParse({ q: "x".repeat(101) }).success).toBe(false);
    expect(mergeSearchQuerySchema.safeParse({ q: "ivan", exclude: "x".repeat(65) }).success).toBe(false);
  });
});

describe("mergePairSchema / mergeExecuteSchema", () => {
  it("AC-E2.2: the same account can't be both sides", () => {
    const res = mergePairSchema.safeParse({ primaryId: "a", secondaryId: "a" });
    expect(res.success).toBe(false);
    expect(res.error?.issues[0].message).toBe(SAME_ACCOUNT_MESSAGE);
  });

  it("AC-E2.5: execution requires confirmIrreversible === true", () => {
    expect(mergeExecuteSchema.safeParse({ primaryId: "a", secondaryId: "b" }).success).toBe(false);
    expect(mergeExecuteSchema.safeParse({ primaryId: "a", secondaryId: "b", confirmIrreversible: false }).success).toBe(false);
    expect(
      mergeExecuteSchema.parse({ primaryId: "a", secondaryId: "b", confirmIrreversible: true, confirmTelegramConflict: true }),
    ).toEqual({ primaryId: "a", secondaryId: "b", confirmIrreversible: true, confirmTelegramConflict: true });
  });

  it("ids are bounded", () => {
    expect(mergePairSchema.safeParse({ primaryId: "", secondaryId: "b" }).success).toBe(false);
    expect(mergePairSchema.safeParse({ primaryId: "a".repeat(65), secondaryId: "b" }).success).toBe(false);
  });
});

describe("merge requests", () => {
  it("only `dismiss`, strict body", () => {
    expect(mergeRequestActionSchema.safeParse({ action: "dismiss" }).success).toBe(true);
    expect(mergeRequestActionSchema.safeParse({ action: "merge" }).success).toBe(false);
    expect(mergeRequestActionSchema.safeParse({ action: "dismiss", extra: 1 }).success).toBe(false);
  });

  it("optional userId filter", () => {
    expect(mergeRequestsQuerySchema.parse({})).toEqual({});
    expect(mergeRequestsQuerySchema.safeParse({ userId: "x".repeat(65) }).success).toBe(false);
  });
});
