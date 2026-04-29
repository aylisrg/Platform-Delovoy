import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks ---------------------------------------------------------------
vi.mock("@/lib/db", () => ({
  prisma: {
    avitoReview: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      aggregate: vi.fn(),
    },
    avitoItem: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/telegram-alert", () => ({
  sendTelegramAlert: vi.fn(async () => true),
}));

vi.mock("@/lib/avito/client", () => ({
  avitoFetch: vi.fn(),
  isAvitoCredentialsConfigured: vi.fn(() => true),
}));

import { prisma } from "@/lib/db";
import { sendTelegramAlert } from "@/lib/telegram-alert";
import { avitoFetch, isAvitoCredentialsConfigured } from "@/lib/avito/client";
import { syncReviewsForItem, syncAllReviews } from "../reviews";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const mockedFetch = avitoFetch as unknown as ReturnType<typeof vi.fn>;
const mockedTelegram = sendTelegramAlert as unknown as ReturnType<typeof vi.fn>;
const mockedConfigured = isAvitoCredentialsConfigured as unknown as ReturnType<typeof vi.fn>;

const ITEM = { id: "db-id-1", avitoItemId: "9000", title: "Беседка №1", url: "https://avito.ru/9000" };

beforeEach(() => {
  vi.clearAllMocks();
  mockedConfigured.mockReturnValue(true);
  // default aggregate response (no reviews)
  db.avitoReview.aggregate.mockResolvedValue({
    _avg: { rating: null },
    _count: { _all: 0 },
  });
});

describe("syncReviewsForItem", () => {
  it("inserts only new reviews — repeated sync does not duplicate (UNIQUE)", async () => {
    mockedFetch.mockResolvedValue({
      reviews: [
        { id: "r1", rating: 5, authorName: "Иван", body: "Отлично", reviewedAt: "2026-04-20" },
        { id: "r2", rating: 4, authorName: "Маша", body: "Хорошо", reviewedAt: "2026-04-21" },
      ],
    });

    db.avitoReview.findUnique
      .mockResolvedValueOnce(null) // r1 — new
      .mockResolvedValueOnce(null); // r2 — new
    db.avitoReview.create.mockResolvedValue({});
    db.avitoReview.aggregate.mockResolvedValue({
      _avg: { rating: 4.5 },
      _count: { _all: 2 },
    });

    const result = await syncReviewsForItem(ITEM);

    expect(result.added).toBe(2);
    expect(result.alerted).toBe(0);
    expect(db.avitoReview.create).toHaveBeenCalledTimes(2);
    expect(mockedTelegram).not.toHaveBeenCalled();

    // Second sync — both reviews exist, nothing new added.
    db.avitoReview.findUnique.mockReset();
    db.avitoReview.create.mockReset();
    db.avitoReview.findUnique
      .mockResolvedValueOnce({ id: "x", alertSent: false, rating: 5 })
      .mockResolvedValueOnce({ id: "y", alertSent: false, rating: 4 });

    const second = await syncReviewsForItem(ITEM);
    expect(second.added).toBe(0);
    expect(db.avitoReview.create).not.toHaveBeenCalled();
  });

  it("rating <= 3 sends Telegram alert exactly once (alertSent guard)", async () => {
    mockedFetch.mockResolvedValue({
      reviews: [{ id: "neg-1", rating: 3, authorName: "A", body: "Так себе", reviewedAt: "2026-04-22" }],
    });

    // First sync — review is new, alert should fire.
    db.avitoReview.findUnique.mockResolvedValueOnce(null);
    db.avitoReview.create.mockResolvedValue({});
    db.avitoReview.aggregate.mockResolvedValue({ _avg: { rating: 3 }, _count: { _all: 1 } });

    const r1 = await syncReviewsForItem(ITEM);
    expect(r1.added).toBe(1);
    expect(r1.alerted).toBe(1);
    expect(mockedTelegram).toHaveBeenCalledTimes(1);
    expect(db.avitoReview.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ alertSent: true, rating: 3 }),
      })
    );

    // Second sync — review already exists with alertSent=true → no alert.
    mockedTelegram.mockClear();
    db.avitoReview.findUnique.mockReset();
    db.avitoReview.create.mockReset();
    db.avitoReview.findUnique.mockResolvedValueOnce({ id: "x", alertSent: true, rating: 3 });

    const r2 = await syncReviewsForItem(ITEM);
    expect(r2.alerted).toBe(0);
    expect(mockedTelegram).not.toHaveBeenCalled();
  });

  it("retroactively sends alert for stored review whose alert was missed (alertSent=false)", async () => {
    mockedFetch.mockResolvedValue({
      reviews: [{ id: "neg-2", rating: 2, authorName: "Z", body: "Плохо", reviewedAt: "2026-04-22" }],
    });
    db.avitoReview.findUnique.mockResolvedValueOnce({ id: "stored", alertSent: false, rating: 2 });
    db.avitoReview.update.mockResolvedValue({});

    const r = await syncReviewsForItem(ITEM);
    expect(r.added).toBe(0);
    expect(r.alerted).toBe(1);
    expect(mockedTelegram).toHaveBeenCalledTimes(1);
    expect(db.avitoReview.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { avitoReviewId: "neg-2" },
        data: { alertSent: true },
      })
    );
  });

  it("rating > 3 (positive) does not alert", async () => {
    mockedFetch.mockResolvedValue({
      reviews: [{ id: "pos-1", rating: 4, body: "ок", reviewedAt: "2026-04-22" }],
    });
    db.avitoReview.findUnique.mockResolvedValueOnce(null);
    db.avitoReview.create.mockResolvedValue({});

    const r = await syncReviewsForItem(ITEM);
    expect(r.alerted).toBe(0);
    expect(mockedTelegram).not.toHaveBeenCalled();
  });

  it("updates avgRating + reviewsCount on AvitoItem after sync", async () => {
    mockedFetch.mockResolvedValue({ reviews: [] });
    db.avitoReview.aggregate.mockResolvedValue({
      _avg: { rating: 4.6 },
      _count: { _all: 5 },
    });

    await syncReviewsForItem(ITEM);

    expect(db.avitoItem.update).toHaveBeenCalledWith({
      where: { id: ITEM.id },
      data: { avgRating: 4.6, reviewsCount: 5 },
    });
  });

  it("avgRating becomes null when no reviews exist", async () => {
    mockedFetch.mockResolvedValue({ reviews: [] });
    db.avitoReview.aggregate.mockResolvedValue({
      _avg: { rating: null },
      _count: { _all: 0 },
    });

    await syncReviewsForItem(ITEM);

    expect(db.avitoItem.update).toHaveBeenCalledWith({
      where: { id: ITEM.id },
      data: { avgRating: null, reviewsCount: 0 },
    });
  });

  it("ignores reviews with missing/invalid rating", async () => {
    mockedFetch.mockResolvedValue({
      reviews: [
        { id: "no-rating", body: "no stars" },
        { id: "out-of-range", rating: 99, body: "?" },
        { id: "valid", rating: 5, body: "ok" },
      ],
    });
    db.avitoReview.findUnique.mockResolvedValueOnce(null);
    db.avitoReview.create.mockResolvedValue({});

    const r = await syncReviewsForItem(ITEM);
    expect(r.added).toBe(1);
  });

  it("returns zero counters and does not throw when Avito API fails", async () => {
    mockedFetch.mockRejectedValue(new Error("network down"));
    const r = await syncReviewsForItem(ITEM);
    expect(r.added).toBe(0);
    expect(r.alerted).toBe(0);
    expect(db.avitoItem.update).not.toHaveBeenCalled();
  });

  it("handles result wrapper shape { result: { reviews } }", async () => {
    mockedFetch.mockResolvedValue({
      result: { reviews: [{ id: "r3", rating: 5, body: "ok" }] },
    });
    db.avitoReview.findUnique.mockResolvedValueOnce(null);
    db.avitoReview.create.mockResolvedValue({});

    const r = await syncReviewsForItem(ITEM);
    expect(r.added).toBe(1);
  });

  it("treats Prisma P2002 unique-violation as already-synced (no throw)", async () => {
    mockedFetch.mockResolvedValue({
      reviews: [{ id: "race-1", rating: 4, body: "ok" }],
    });
    db.avitoReview.findUnique.mockResolvedValueOnce(null);
    const e = Object.assign(new Error("unique"), { code: "P2002" });
    db.avitoReview.create.mockRejectedValueOnce(e);

    await expect(syncReviewsForItem(ITEM)).resolves.toEqual({ added: 0, alerted: 0 });
  });
});

describe("syncAllReviews", () => {
  it("iterates over all ACTIVE non-deleted items", async () => {
    db.avitoItem.findMany.mockResolvedValue([
      { id: "i1", avitoItemId: "1", title: "A", url: null },
      { id: "i2", avitoItemId: "2", title: "B", url: null },
    ]);
    mockedFetch.mockResolvedValue({ reviews: [] });
    db.avitoReview.aggregate.mockResolvedValue({ _avg: { rating: null }, _count: { _all: 0 } });

    const r = await syncAllReviews();
    expect(r.items).toBe(2);
    expect(db.avitoItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deletedAt: null, status: "ACTIVE" },
      })
    );
  });

  it("aggregates added + alerted across items", async () => {
    db.avitoItem.findMany.mockResolvedValue([
      { id: "i1", avitoItemId: "1", title: "A", url: null },
      { id: "i2", avitoItemId: "2", title: "B", url: null },
    ]);
    mockedFetch
      .mockResolvedValueOnce({ reviews: [{ id: "x1", rating: 5, body: "ok" }] })
      .mockResolvedValueOnce({ reviews: [{ id: "x2", rating: 1, body: "плохо" }] });
    db.avitoReview.findUnique
      .mockResolvedValueOnce(null) // x1
      .mockResolvedValueOnce(null); // x2
    db.avitoReview.create.mockResolvedValue({});

    const r = await syncAllReviews();
    expect(r.items).toBe(2);
    expect(r.added).toBe(2);
    expect(r.alerted).toBe(1);
  });

  it("isolates per-item failures — one bad item does not break the loop", async () => {
    db.avitoItem.findMany.mockResolvedValue([
      { id: "good", avitoItemId: "1", title: "A", url: null },
      { id: "bad", avitoItemId: "2", title: "B", url: null },
    ]);
    mockedFetch
      .mockResolvedValueOnce({ reviews: [{ id: "x1", rating: 5, body: "ok" }] })
      .mockResolvedValueOnce({ reviews: [{ id: "x2", rating: 5, body: "ok" }] });
    db.avitoReview.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    db.avitoReview.create
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("DB down"));

    const r = await syncAllReviews();
    expect(r.items).toBe(2);
    // First item's review was added, the second blew up but was caught.
    expect(r.added).toBe(1);
  });
});

describe("syncReviewsForItem when credentials missing", () => {
  it("returns empty counters without touching DB or Telegram", async () => {
    mockedConfigured.mockReturnValue(false);
    // fetchReviewsForItem early-returns []; avitoFetch must not be called.
    mockedFetch.mockReset();

    const r = await syncReviewsForItem(ITEM);
    expect(r.added).toBe(0);
    expect(r.alerted).toBe(0);
    expect(mockedFetch).not.toHaveBeenCalled();
    expect(mockedTelegram).not.toHaveBeenCalled();
  });
});
