import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/telegram-alert", () => ({
  sendTelegramAlert: vi.fn(async () => true),
}));

import { notifyBackup, notifyRestore } from "../notify";
import { sendTelegramAlert } from "@/lib/telegram-alert";

const mockSend = sendTelegramAlert as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("notifyBackup", () => {
  it("sends FAILED alert with error text", async () => {
    await notifyBackup({
      type: "DAILY",
      status: "FAILED",
      error: "pg_dump exit 1",
    });
    expect(mockSend).toHaveBeenCalledOnce();
    const [text] = mockSend.mock.calls[0];
    expect(text).toContain("CRITICAL");
    expect(text).toContain("DAILY");
    expect(text).toContain("pg_dump exit 1");
  });

  it("skips SUCCESS by default", async () => {
    await notifyBackup({ type: "DAILY", status: "SUCCESS" });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("sends SUCCESS when notifyOnSuccess=true", async () => {
    await notifyBackup({
      type: "DAILY",
      status: "SUCCESS",
      sizeBytes: 1024 * 1024,
      notifyOnSuccess: true,
    });
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it("escapes HTML in error message", async () => {
    await notifyBackup({
      type: "DAILY",
      status: "FAILED",
      error: "<script>alert(1)</script>",
    });
    const [text] = mockSend.mock.calls[0];
    expect(text).not.toContain("<script>");
    expect(text).toContain("&lt;script&gt;");
  });
});

describe("notifyRestore", () => {
  it("marks DRY-RUN prefix", async () => {
    await notifyRestore({
      scope: "record",
      table: "Booking",
      status: "SUCCESS",
      dryRun: true,
    });
    const [text] = mockSend.mock.calls[0];
    expect(text).toContain("[DRY-RUN]");
  });

  it("sends without dryRun prefix for real restore", async () => {
    await notifyRestore({
      scope: "table",
      table: "Order",
      status: "SUCCESS",
      affectedRows: 12,
      performedByName: "Илья",
    });
    const [text] = mockSend.mock.calls[0];
    expect(text).not.toContain("[DRY-RUN]");
    expect(text).toContain("Order");
    expect(text).toContain("Илья");
    expect(text).toContain("12");
  });
});
