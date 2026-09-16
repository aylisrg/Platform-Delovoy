import { describe, it, expect } from "vitest";
import { analyticsQuerySchema, productEventIngestSchema, funnelStatsQuerySchema } from "../validation";

describe("analyticsQuerySchema", () => {
  it("accepts valid period", () => {
    const result = analyticsQuerySchema.safeParse({ period: "7d" });
    expect(result.success).toBe(true);
  });

  it("accepts empty object with defaults", () => {
    const result = analyticsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.forceRefresh).toBe(false);
    }
  });

  it("accepts custom date range", () => {
    const result = analyticsQuerySchema.safeParse({
      dateFrom: "2026-04-01",
      dateTo: "2026-04-10",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid date format", () => {
    const result = analyticsQuerySchema.safeParse({ dateFrom: "01-04-2026" });
    expect(result.success).toBe(false);
  });

  it("rejects dateFrom > dateTo", () => {
    const result = analyticsQuerySchema.safeParse({
      dateFrom: "2026-04-15",
      dateTo: "2026-04-01",
    });
    expect(result.success).toBe(false);
  });

  it("rejects future dates", () => {
    const result = analyticsQuerySchema.safeParse({
      dateTo: "2099-01-01",
    });
    expect(result.success).toBe(false);
  });

  it("parses forceRefresh string 'true' to boolean", () => {
    const result = analyticsQuerySchema.safeParse({ forceRefresh: "true" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.forceRefresh).toBe(true);
    }
  });

  it("rejects invalid period", () => {
    const result = analyticsQuerySchema.safeParse({ period: "90d" });
    expect(result.success).toBe(false);
  });
});

describe("productEventIngestSchema", () => {
  it("принимает клиентский шаг своей воронки", () => {
    const result = productEventIngestSchema.safeParse({ funnel: "gazebos", step: "slot_selected" });
    expect(result.success).toBe(true);
  });

  it("отклоняет серверный шаг (submitted) — подделать конверсию через ingest нельзя", () => {
    const result = productEventIngestSchema.safeParse({ funnel: "gazebos", step: "submitted" });
    expect(result.success).toBe(false);
  });

  it("отклоняет серверный шаг view", () => {
    const result = productEventIngestSchema.safeParse({ funnel: "cafe", step: "view" });
    expect(result.success).toBe(false);
  });

  it("отклоняет шаг, которого у этой воронки вообще нет (form_started у cafe)", () => {
    const result = productEventIngestSchema.safeParse({ funnel: "cafe", step: "form_started" });
    expect(result.success).toBe(false);
  });

  it("отклоняет неизвестную воронку", () => {
    const result = productEventIngestSchema.safeParse({ funnel: "not-a-funnel", step: "view" });
    expect(result.success).toBe(false);
  });

  it("отклоняет лишние поля (.strict()) — sessionKey/metadata от клиента не принимаются", () => {
    const result = productEventIngestSchema.safeParse({
      funnel: "gazebos",
      step: "slot_selected",
      sessionKey: "forged",
      metadata: { amountRub: 1 },
    });
    expect(result.success).toBe(false);
  });
});

describe("funnelStatsQuerySchema", () => {
  it("принимает валидный период без funnel", () => {
    const result = funnelStatsQuerySchema.safeParse({ dateFrom: "2026-09-01", dateTo: "2026-09-07" });
    expect(result.success).toBe(true);
  });

  it("принимает валидный период с конкретной воронкой", () => {
    const result = funnelStatsQuerySchema.safeParse({
      funnel: "cafe",
      dateFrom: "2026-09-01",
      dateTo: "2026-09-07",
    });
    expect(result.success).toBe(true);
  });

  it("отклоняет неизвестную воронку", () => {
    const result = funnelStatsQuerySchema.safeParse({
      funnel: "not-a-funnel",
      dateFrom: "2026-09-01",
      dateTo: "2026-09-07",
    });
    expect(result.success).toBe(false);
  });

  it("отклоняет dateFrom > dateTo", () => {
    const result = funnelStatsQuerySchema.safeParse({ dateFrom: "2026-09-07", dateTo: "2026-09-01" });
    expect(result.success).toBe(false);
  });

  it("отклоняет dateTo в будущем", () => {
    const result = funnelStatsQuerySchema.safeParse({ dateFrom: "2026-09-01", dateTo: "2099-01-01" });
    expect(result.success).toBe(false);
  });

  it("отклоняет период длиннее 180 дней", () => {
    const result = funnelStatsQuerySchema.safeParse({ dateFrom: "2026-01-01", dateTo: "2026-09-01" });
    expect(result.success).toBe(false);
  });

  it("принимает период ровно 180 дней", () => {
    const result = funnelStatsQuerySchema.safeParse({ dateFrom: "2026-03-01", dateTo: "2026-08-28" });
    expect(result.success).toBe(true);
  });
});
