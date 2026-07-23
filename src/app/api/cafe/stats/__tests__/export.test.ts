import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/modules/cafe/service", () => ({ getCafeStats: vi.fn() }));

import { GET } from "../export/route";
import { auth } from "@/lib/auth";
import { getCafeStats } from "@/modules/cafe/service";

function makeRequest(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/cafe/stats/export${query}`);
}

const superadmin = { user: { id: "s1", role: "SUPERADMIN" } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCafeStats).mockResolvedValue({
    ordersCount: 2,
    revenue: 610,
    avgCheck: 305,
    onlineCount: 1,
    onlineRevenue: 430,
    byDay: [{ date: "2026-07-20", orders: 2, revenue: 610 }],
    topItems: [
      { menuItemId: "i1", name: 'Круассан "Париж"', category: "Выпечка", quantity: 3, revenue: 540 },
    ],
    byCategory: [{ category: "Выпечка", quantity: 3, revenue: 540 }],
    byPaymentMethod: [{ method: "sbp", count: 1 }],
  });
});

describe("GET /api/cafe/stats/export", () => {
  it("аноним → 401", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const res = await GET(makeRequest("?dateFrom=2026-07-01&dateTo=2026-07-22"));
    expect(res.status).toBe(401);
  });

  it("роль USER → 403", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1", role: "USER" } } as never);
    const res = await GET(makeRequest("?dateFrom=2026-07-01&dateTo=2026-07-22"));
    expect(res.status).toBe(403);
  });

  it("невалидный период → 422", async () => {
    vi.mocked(auth).mockResolvedValue(superadmin as never);
    const res = await GET(makeRequest("?dateFrom=2026-07-22&dateTo=2026-07-01"));
    expect(res.status).toBe(422);
  });

  it("CSV: BOM, заголовки, экранирование кавычек, имя файла", async () => {
    vi.mocked(auth).mockResolvedValue(superadmin as never);
    const res = await GET(makeRequest("?dateFrom=2026-07-01&dateTo=2026-07-22"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain(
      'filename="cafe-stats-2026-07-01-2026-07-22.csv"'
    );

    const bytes = new Uint8Array(await res.clone().arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM для Excel

    const text = await res.text();
    expect(text).toContain("Заказов;2");
    expect(text).toContain("Выручка, ₽;610.00");
    expect(text).toContain("2026-07-20;2;610.00");
    expect(text).toContain('"Круассан ""Париж""";Выпечка;3;540.00');
    expect(text).toContain("sbp;1");
    expect(getCafeStats).toHaveBeenCalledWith({
      dateFrom: "2026-07-01",
      dateTo: "2026-07-22",
    });
  });
});
