import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma
vi.mock("@/lib/db", () => ({
  prisma: {
    inventorySku: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    stockReceipt: {
      findFirst: vi.fn(),
    },
  },
}));

// Mock redis
vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(),
    setex: vi.fn(),
  },
  redisAvailable: true,
}));

// Mock fetch for Telegram
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";
import { checkAndSendLowStockAlert, runLowStockAlertSweep } from "../alerts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockRedis = redis as any;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_ADMIN_CHAT_ID = "test-chat-id";
  mockFetch.mockResolvedValue({ ok: true });
});

describe("checkAndSendLowStockAlert", () => {
  it("does nothing when SKU is above threshold", async () => {
    db.inventorySku.findUnique.mockResolvedValue({
      id: "sku1",
      name: "Кола",
      unit: "шт",
      stockQuantity: 10,
      lowStockThreshold: 5,
      isActive: true,
    });

    await checkAndSendLowStockAlert("sku1");

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does nothing when SKU is inactive", async () => {
    db.inventorySku.findUnique.mockResolvedValue({
      id: "sku1",
      name: "Кола",
      unit: "шт",
      stockQuantity: 1,
      lowStockThreshold: 5,
      isActive: false,
    });

    await checkAndSendLowStockAlert("sku1");

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("sends Telegram alert when below threshold and no Redis dedup key", async () => {
    db.inventorySku.findUnique.mockResolvedValue({
      id: "sku1",
      name: "Уголь",
      unit: "кг",
      stockQuantity: 2,
      lowStockThreshold: 10,
      isActive: true,
    });
    mockRedis.get.mockResolvedValue(null);
    db.stockReceipt.findFirst.mockResolvedValue(null);

    await checkAndSendLowStockAlert("sku1");

    expect(mockFetch).toHaveBeenCalledOnce();
    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[0]).toContain("sendMessage");
    const body = JSON.parse(callArgs[1].body);
    expect(body.text).toContain("Уголь");
    expect(body.text).toContain("2 кг");
  });

  it("skips sending when Redis dedup key exists", async () => {
    db.inventorySku.findUnique.mockResolvedValue({
      id: "sku1",
      name: "Уголь",
      unit: "кг",
      stockQuantity: 2,
      lowStockThreshold: 10,
      isActive: true,
    });
    mockRedis.get.mockResolvedValue("1"); // dedup key exists

    await checkAndSendLowStockAlert("sku1");

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("sets Redis dedup key after sending", async () => {
    db.inventorySku.findUnique.mockResolvedValue({
      id: "sku1",
      name: "Чипсы",
      unit: "шт",
      stockQuantity: 1,
      lowStockThreshold: 5,
      isActive: true,
    });
    mockRedis.get.mockResolvedValue(null);
    db.stockReceipt.findFirst.mockResolvedValue(null);

    await checkAndSendLowStockAlert("sku1");

    expect(mockRedis.setex).toHaveBeenCalledWith(
      expect.stringContaining("sku1"),
      86400,
      "1"
    );
  });

  it("includes supplier info in the alert when last receipt is available", async () => {
    db.inventorySku.findUnique.mockResolvedValue({
      id: "sku1",
      name: "Напиток",
      unit: "л",
      stockQuantity: 0,
      lowStockThreshold: 5,
      isActive: true,
    });
    mockRedis.get.mockResolvedValue(null);
    db.stockReceipt.findFirst.mockResolvedValue({
      supplier: { name: "ООО Снабжение", phone: "+7900" },
    });

    await checkAndSendLowStockAlert("sku1");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text).toContain("ООО Снабжение");
  });

  it("does not throw when Telegram is not configured", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    db.inventorySku.findUnique.mockResolvedValue({
      id: "sku1",
      name: "Товар",
      unit: "шт",
      stockQuantity: 0,
      lowStockThreshold: 5,
      isActive: true,
    });
    mockRedis.get.mockResolvedValue(null);
    db.stockReceipt.findFirst.mockResolvedValue(null);

    await expect(checkAndSendLowStockAlert("sku1")).resolves.not.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("runLowStockAlertSweep", () => {
  it("sends alerts for SKUs below threshold", async () => {
    db.inventorySku.findMany.mockResolvedValue([
      { id: "sku1", name: "Кола", unit: "шт", stockQuantity: 2, lowStockThreshold: 10 },
      { id: "sku2", name: "Вода", unit: "л", stockQuantity: 15, lowStockThreshold: 5 },
    ]);
    mockRedis.get.mockResolvedValue(null);

    const result = await runLowStockAlertSweep();

    expect(result.checked).toBe(2);
    expect(result.alerted).toBe(1);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("returns 0 alerted when all SKUs are above threshold", async () => {
    db.inventorySku.findMany.mockResolvedValue([
      { id: "sku1", name: "Кола", unit: "шт", stockQuantity: 20, lowStockThreshold: 5 },
    ]);

    const result = await runLowStockAlertSweep();

    expect(result.alerted).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("skips already-alerted SKUs via Redis", async () => {
    db.inventorySku.findMany.mockResolvedValue([
      { id: "sku1", name: "Кола", unit: "шт", stockQuantity: 1, lowStockThreshold: 10 },
    ]);
    mockRedis.get.mockResolvedValue("1"); // already alerted

    const result = await runLowStockAlertSweep();

    expect(result.alerted).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
