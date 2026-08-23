import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    offerVersion: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db";
import {
  DOCUMENT_KEYS,
  OfferError,
  bookingNumber,
  buildAcceptance,
  createManageToken,
  getCurrentVersion,
  hashDocumentBody,
  hashManageToken,
  manageTokenMatches,
} from "../offer";

const findFirst = prisma.offerVersion.findFirst as unknown as ReturnType<typeof vi.fn>;

const version = {
  id: "ov-1",
  documentKey: DOCUMENT_KEYS.gazebosOffer,
  number: 1,
  slug: "v1",
  title: "ПУБЛИЧНАЯ ОФЕРТА",
  body: "# ПУБЛИЧНАЯ ОФЕРТА\n",
  contentHash: "abc123",
  publishedAt: new Date("2026-08-21T00:00:00Z"),
  effectiveAt: new Date("2026-08-22T00:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  // Токен управления бронью выводится из серверного секрета.
  process.env.AUTH_SECRET = "test-secret";
});

describe("hashDocumentBody", () => {
  it("стабилен для одного и того же текста", () => {
    expect(hashDocumentBody("текст")).toBe(hashDocumentBody("текст"));
  });

  it("меняется при любой правке текста — иначе хеш ничего не доказывает", () => {
    expect(hashDocumentBody("текст")).not.toBe(hashDocumentBody("текст."));
  });

  it("не зависит от переводов строк платформы", () => {
    expect(hashDocumentBody("а\r\nб")).toBe(hashDocumentBody("а\nб"));
  });

  it("даёт 64 hex-символа (SHA-256)", () => {
    expect(hashDocumentBody("x")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("getCurrentVersion", () => {
  it("ищет действующую редакцию нужного документа", async () => {
    findFirst.mockResolvedValue(version);
    await getCurrentVersion(DOCUMENT_KEYS.gazebosOffer);
    expect(findFirst).toHaveBeenCalledWith({
      where: { documentKey: "gazebos-offer", isCurrent: true },
      orderBy: { number: "desc" },
    });
  });
});

describe("buildAcceptance", () => {
  it("копирует id и хеш редакции и штампует момент акцепта", async () => {
    findFirst.mockResolvedValue(version);
    const before = Date.now();
    const acceptance = await buildAcceptance(DOCUMENT_KEYS.gazebosOffer, {
      offerVersionSlug: "v1",
      acceptMarketing: true,
      ip: "203.0.113.7",
      userAgent: "Mozilla/5.0",
    });

    expect(acceptance.offerVersionId).toBe("ov-1");
    expect(acceptance.offerContentHash).toBe("abc123");
    expect(acceptance.acceptedMarketing).toBe(true);
    expect(acceptance.acceptedIp).toBe("203.0.113.7");
    expect(acceptance.acceptedUserAgent).toBe("Mozilla/5.0");
    expect(acceptance.acceptedOfferAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("отказывает, если редакция сменилась, пока клиент читал документ", async () => {
    findFirst.mockResolvedValue({ ...version, slug: "v2" });
    await expect(
      buildAcceptance(DOCUMENT_KEYS.gazebosOffer, {
        offerVersionSlug: "v1",
        acceptMarketing: false,
        ip: null,
        userAgent: null,
      })
    ).rejects.toMatchObject({ code: "OFFER_VERSION_STALE" });
  });

  it("отказывает, если оферта ещё не опубликована", async () => {
    findFirst.mockResolvedValue(null);
    await expect(
      buildAcceptance(DOCUMENT_KEYS.gazebosOffer, {
        offerVersionSlug: "v1",
        acceptMarketing: false,
        ip: null,
        userAgent: null,
      })
    ).rejects.toBeInstanceOf(OfferError);
  });

  it("обрезает слишком длинный User-Agent", async () => {
    findFirst.mockResolvedValue(version);
    const acceptance = await buildAcceptance(DOCUMENT_KEYS.gazebosOffer, {
      offerVersionSlug: "v1",
      acceptMarketing: false,
      ip: null,
      userAgent: "U".repeat(2000),
    });
    expect(acceptance.acceptedUserAgent).toHaveLength(512);
  });

  it("не выдумывает согласие: acceptMarketing приходит из тела запроса", async () => {
    findFirst.mockResolvedValue(version);
    const acceptance = await buildAcceptance(DOCUMENT_KEYS.gazebosOffer, {
      offerVersionSlug: "v1",
      acceptMarketing: false,
      ip: null,
      userAgent: null,
    });
    expect(acceptance.acceptedMarketing).toBe(false);
  });
});

describe("токен управления бронью", () => {
  it("в БД кладётся только хеш — сам токен по нему не восстановим", () => {
    const { token, hash } = createManageToken("bk-1")!;
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashManageToken(token)).toBe(hash);
  });

  it("для одной брони токен один и тот же — выданная ссылка не умирает", () => {
    expect(createManageToken("bk-1")!.token).toBe(createManageToken("bk-1")!.token);
  });

  it("у разных броней токены разные", () => {
    expect(createManageToken("bk-1")!.token).not.toBe(createManageToken("bk-2")!.token);
  });

  it("не выводится из одного лишь номера брони — нужен серверный секрет", () => {
    const withSecret = createManageToken("bk-1")!.token;
    const previous = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "другой-секрет";
    expect(createManageToken("bk-1")!.token).not.toBe(withSecret);
    process.env.AUTH_SECRET = previous;
  });

  it("совпадает только со своим хешем", () => {
    const { token, hash } = createManageToken("bk-1")!;
    expect(manageTokenMatches(token, hash)).toBe(true);
    expect(manageTokenMatches("подделка", hash)).toBe(false);
  });

  it("не падает на мусорном хеше из БД", () => {
    const { token } = createManageToken("bk-1")!;
    expect(manageTokenMatches(token, "короткий")).toBe(false);
    expect(manageTokenMatches(token, "")).toBe(false);
  });
});

describe("bookingNumber", () => {
  it("строит человекочитаемый номер из id брони", () => {
    expect(bookingNumber("clx9y8z7q0000abcdef123456")).toBe("БП-123456");
  });

  it("устойчив к короткому id", () => {
    expect(bookingNumber("abc")).toBe("БП-ABC");
  });
});
