import { describe, it, expect } from "vitest";
import {
  initiateCallSchema,
  callFilterSchema,
  novofonWebhookSchema,
} from "../validation";

describe("initiateCallSchema", () => {
  it("accepts valid gazebos booking request", () => {
    const result = initiateCallSchema.safeParse({
      bookingId: "clxyz123",
      moduleSlug: "gazebos",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.bookingId).toBe("clxyz123");
      expect(result.data.moduleSlug).toBe("gazebos");
    }
  });

  it("accepts valid ps-park booking request", () => {
    const result = initiateCallSchema.safeParse({
      bookingId: "clps456",
      moduleSlug: "ps-park",
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown moduleSlug", () => {
    const result = initiateCallSchema.safeParse({
      bookingId: "clxyz123",
      moduleSlug: "cafe",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty bookingId", () => {
    const result = initiateCallSchema.safeParse({
      bookingId: "",
      moduleSlug: "gazebos",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing fields", () => {
    expect(initiateCallSchema.safeParse({}).success).toBe(false);
    expect(initiateCallSchema.safeParse({ bookingId: "abc" }).success).toBe(false);
    expect(initiateCallSchema.safeParse({ moduleSlug: "gazebos" }).success).toBe(false);
  });
});

describe("callFilterSchema", () => {
  it("provides defaults for page and perPage", () => {
    const result = callFilterSchema.parse({});
    expect(result.page).toBe(1);
    expect(result.perPage).toBe(20);
  });

  it("accepts all optional filters", () => {
    const result = callFilterSchema.safeParse({
      bookingId: "clxyz123",
      moduleSlug: "gazebos",
      status: "COMPLETED",
      dateFrom: "2026-04-01",
      dateTo: "2026-04-30",
      page: "2",
      perPage: "10",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(2);
      expect(result.data.perPage).toBe(10);
      expect(result.data.status).toBe("COMPLETED");
    }
  });

  it("rejects invalid status", () => {
    const result = callFilterSchema.safeParse({ status: "UNKNOWN" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid date format", () => {
    const result = callFilterSchema.safeParse({ dateFrom: "01/04/2026" });
    expect(result.success).toBe(false);
  });

  it("rejects perPage > 100", () => {
    const result = callFilterSchema.safeParse({ perPage: "200" });
    expect(result.success).toBe(false);
  });

  it("rejects page < 1", () => {
    const result = callFilterSchema.safeParse({ page: "0" });
    expect(result.success).toBe(false);
  });
});

describe("novofonWebhookSchema", () => {
  it("accepts minimal webhook payload", () => {
    const result = novofonWebhookSchema.safeParse({
      event: "call.completed",
      call_id: "novofon-call-123",
    });
    expect(result.success).toBe(true);
  });

  it("accepts full webhook payload", () => {
    const result = novofonWebhookSchema.safeParse({
      event: "call.completed",
      call_id: "novofon-call-123",
      direction: "outbound",
      duration: 145,
      recording_url: "https://storage.novofon.com/rec/abc.mp3",
      caller: "+74951234567",
      callee: "+79001234567",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.duration).toBe(145);
      expect(result.data.recording_url).toBe("https://storage.novofon.com/rec/abc.mp3");
    }
  });

  it("rejects invalid recording_url", () => {
    const result = novofonWebhookSchema.safeParse({
      event: "call.completed",
      call_id: "abc",
      recording_url: "not-a-url",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid direction", () => {
    const result = novofonWebhookSchema.safeParse({
      event: "call.ringing",
      call_id: "abc",
      direction: "unknown",
    });
    expect(result.success).toBe(false);
  });

  it("passes through extra fields (Novofon may add fields)", () => {
    const result = novofonWebhookSchema.safeParse({
      event: "call.completed",
      call_id: "abc",
      some_custom_field: "value",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).some_custom_field).toBe("value");
    }
  });

  it("rejects missing required fields", () => {
    expect(novofonWebhookSchema.safeParse({ event: "call.completed" }).success).toBe(false);
    expect(novofonWebhookSchema.safeParse({ call_id: "abc" }).success).toBe(false);
  });
});
