import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const { mockAuth, mockSearchOffices } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockSearchOffices: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/modules/rental/service", () => ({
  searchOffices: mockSearchOffices,
}));

import { GET } from "../route";

beforeEach(() => {
  vi.clearAllMocks();
});

function makeReq(qs: Record<string, string>): NextRequest {
  const url = new URL("https://example.test/api/rental/offices/search");
  for (const [k, v] of Object.entries(qs)) url.searchParams.set(k, v);
  return { nextUrl: url } as unknown as NextRequest;
}

describe("GET /api/rental/offices/search", () => {
  it("returns 401 for anonymous request", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(makeReq({ q: "301" }));
    expect(res.status).toBe(401);
    expect(mockSearchOffices).not.toHaveBeenCalled();
  });

  it("returns 422 when q is missing", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "USER" } });
    const res = await GET(makeReq({}));
    expect(res.status).toBe(422);
    expect(mockSearchOffices).not.toHaveBeenCalled();
  });

  it("returns 422 for empty q", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "USER" } });
    const res = await GET(makeReq({ q: "" }));
    expect(res.status).toBe(422);
  });

  it("returns 422 for q longer than 50 chars", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "USER" } });
    const res = await GET(makeReq({ q: "a".repeat(51) }));
    expect(res.status).toBe(422);
  });

  it("delegates to searchOffices for an authenticated USER", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "USER" } });
    mockSearchOffices.mockResolvedValue([
      {
        id: "o1",
        number: "301",
        building: 1,
        floor: 3,
        status: "AVAILABLE",
      },
    ]);
    const res = await GET(makeReq({ q: "301" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(1);
    expect(json.data[0].number).toBe("301");
    expect(mockSearchOffices).toHaveBeenCalledWith("301");
  });

  it("works for any authenticated role (MANAGER/SUPERADMIN), not just USER", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "MANAGER" } });
    mockSearchOffices.mockResolvedValue([]);
    const res = await GET(makeReq({ q: "1" }));
    expect(res.status).toBe(200);
  });

  it("does NOT leak pricing fields in the response shape", async () => {
    // The service is the source of truth — this test only confirms that
    // the route hands the result through unchanged. service.test.ts has
    // the actual `select` fields contract.
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "USER" } });
    mockSearchOffices.mockResolvedValue([
      {
        id: "o1",
        number: "12",
        building: 1,
        floor: 1,
        status: "OCCUPIED",
      },
    ]);
    const res = await GET(makeReq({ q: "12" }));
    const json = await res.json();
    expect(json.data[0]).not.toHaveProperty("pricePerMonth");
    expect(json.data[0]).not.toHaveProperty("area");
  });
});
