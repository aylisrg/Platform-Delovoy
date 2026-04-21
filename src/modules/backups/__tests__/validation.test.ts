import { describe, it, expect } from "vitest";
import {
  listBackupsQuerySchema,
  restoreRequestSchema,
  deployStagingSchema,
} from "../validation";

describe("listBackupsQuerySchema", () => {
  it("accepts minimal empty query (defaults applied)", () => {
    const r = listBackupsQuerySchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.limit).toBe(50);
      expect(r.data.offset).toBe(0);
    }
  });

  it("coerces numeric strings", () => {
    const r = listBackupsQuerySchema.safeParse({ limit: "25", offset: "10" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.limit).toBe(25);
      expect(r.data.offset).toBe(10);
    }
  });

  it("rejects invalid type", () => {
    const r = listBackupsQuerySchema.safeParse({ type: "HOURLY" });
    expect(r.success).toBe(false);
  });

  it("rejects limit > 100", () => {
    const r = listBackupsQuerySchema.safeParse({ limit: 999 });
    expect(r.success).toBe(false);
  });
});

describe("restoreRequestSchema", () => {
  const base = { backupId: "bk_1", confirmToken: "12345678-abcd" };

  it("accepts valid full restore without target", () => {
    const r = restoreRequestSchema.safeParse({
      ...base,
      scope: "full",
      dryRun: true,
    });
    expect(r.success).toBe(true);
  });

  it("rejects table restore without target", () => {
    const r = restoreRequestSchema.safeParse({ ...base, scope: "table" });
    expect(r.success).toBe(false);
  });

  it("accepts table restore with valid target", () => {
    const r = restoreRequestSchema.safeParse({
      ...base,
      scope: "table",
      target: { scope: "table", table: "Booking" },
    });
    expect(r.success).toBe(true);
  });

  it("rejects table name with invalid characters (SQL injection attempt)", () => {
    const r = restoreRequestSchema.safeParse({
      ...base,
      scope: "table",
      target: { scope: "table", table: "Booking; DROP TABLE User" },
    });
    expect(r.success).toBe(false);
  });

  it("rejects record restore without primaryKey", () => {
    const r = restoreRequestSchema.safeParse({
      ...base,
      scope: "record",
      target: { scope: "record", table: "Booking", primaryKey: {} },
    });
    expect(r.success).toBe(false);
  });

  it("accepts record restore with string PK", () => {
    const r = restoreRequestSchema.safeParse({
      ...base,
      scope: "record",
      target: {
        scope: "record",
        table: "Booking",
        primaryKey: { id: "bk_1" },
      },
    });
    expect(r.success).toBe(true);
  });

  it("requires confirmToken >= 8 chars", () => {
    const r = restoreRequestSchema.safeParse({
      backupId: "bk_1",
      scope: "full",
      confirmToken: "short",
    });
    expect(r.success).toBe(false);
  });

  it("rejects when scope does not match target.scope", () => {
    const r = restoreRequestSchema.safeParse({
      ...base,
      scope: "table",
      target: { scope: "record", table: "Booking", primaryKey: { id: "1" } },
    });
    expect(r.success).toBe(false);
  });
});

describe("deployStagingSchema", () => {
  it("accepts empty request (defaults)", () => {
    const r = deployStagingSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.wipeDatabase).toBe(false);
      expect(r.data.notifyOnComplete).toBe(true);
    }
  });

  it("accepts valid short SHA", () => {
    const r = deployStagingSchema.safeParse({ sha: "abc1234" });
    expect(r.success).toBe(true);
  });

  it("accepts valid full SHA", () => {
    const r = deployStagingSchema.safeParse({
      sha: "abcdef0123456789abcdef0123456789abcdef01",
    });
    expect(r.success).toBe(true);
  });

  it("rejects invalid SHA (too short)", () => {
    const r = deployStagingSchema.safeParse({ sha: "abc" });
    expect(r.success).toBe(false);
  });

  it("rejects SHA with non-hex characters", () => {
    const r = deployStagingSchema.safeParse({ sha: "xyz1234" });
    expect(r.success).toBe(false);
  });
});
