import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { booking: { findMany: (...args: unknown[]) => mockFindMany(...args) } },
}));

import { searchGuestsByPhone } from "../guest-search";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("searchGuestsByPhone (issue #666)", () => {
  it("фильтрует по moduleSlug, deletedAt: null и contains по телефону", async () => {
    mockFindMany.mockResolvedValue([]);

    await searchGuestsByPhone("gazebos", "999");

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          moduleSlug: "gazebos",
          deletedAt: null,
          clientPhone: { contains: "999" },
        }),
      })
    );
  });

  it("дедуплицирует гостей по телефону, оставляя самую свежую бронь", async () => {
    mockFindMany.mockResolvedValue([
      { clientName: "Иван (новое имя)", clientPhone: "+79991234567", createdAt: new Date("2026-08-10") },
      { clientName: "Иван (старое имя)", clientPhone: "+79991234567", createdAt: new Date("2026-01-01") },
    ]);

    const result = await searchGuestsByPhone("gazebos", "999");

    expect(result).toEqual([{ name: "Иван (новое имя)", phone: "+79991234567" }]);
  });

  it("пропускает записи без clientPhone или clientName", async () => {
    mockFindMany.mockResolvedValue([
      { clientName: null, clientPhone: "+79991234567", createdAt: new Date() },
      { clientName: "Гость без телефона", clientPhone: null, createdAt: new Date() },
    ]);

    const result = await searchGuestsByPhone("gazebos", "999");

    expect(result).toEqual([]);
  });

  it("ограничивает выдачу 8 гостями", async () => {
    mockFindMany.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({
        clientName: `Гость ${i}`,
        clientPhone: `+7999123456${i}`,
        createdAt: new Date(),
      }))
    );

    const result = await searchGuestsByPhone("gazebos", "999");

    expect(result).toHaveLength(8);
  });

  it("возвращает пустой список при отсутствии совпадений", async () => {
    mockFindMany.mockResolvedValue([]);

    const result = await searchGuestsByPhone("ps-park", "000");

    expect(result).toEqual([]);
  });
});
