import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/modules/cafe/service", () => ({ listOrders: vi.fn() }));

import { GET } from "../route";
import { auth } from "@/lib/auth";
import { listOrders } from "@/modules/cafe/service";

function makeRequest(query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/cafe/orders${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listOrders).mockResolvedValue({ orders: [], total: 0 } as never);
});

describe("GET /api/cafe/orders — guard (раньше был публичным)", () => {
  it("аноним → 401, сервис не вызывается", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(listOrders).not.toHaveBeenCalled();
  });

  it("USER видит только свои заказы (фильтр userId принудительный)", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1", role: "USER" } } as never);

    // попытка подсмотреть чужие заказы через query
    const res = await GET(makeRequest("?userId=someone-else"));
    expect(res.status).toBe(200);
    expect(listOrders).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1" })
    );
  });

  it("SUPERADMIN: фильтры проходят как есть, включая paid", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "s1", role: "SUPERADMIN" } } as never);

    const res = await GET(makeRequest("?status=NEW&paid=true"));
    expect(res.status).toBe(200);
    expect(listOrders).toHaveBeenCalledWith(
      expect.objectContaining({ status: "NEW", paid: true })
    );
  });
});
