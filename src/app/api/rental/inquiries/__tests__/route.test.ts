import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockAuth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: () => mockAuth() }));

const mockRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({ rateLimit: (...args: unknown[]) => mockRateLimit(...args) }));

vi.mock("@/lib/metrika-server", () => ({ trackServerGoal: vi.fn() }));

const mockProductEventCreate = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { productEvent: { create: (...args: unknown[]) => mockProductEventCreate(...args) } },
}));
vi.mock("@/lib/redis", () => ({ redis: { set: vi.fn() }, redisAvailable: false }));

const mockCreateInquiry = vi.fn();
const mockListInquiries = vi.fn();
vi.mock("@/modules/rental/service", async () => {
  const actual = await vi.importActual<typeof import("@/modules/rental/service")>(
    "@/modules/rental/service"
  );
  return {
    ...actual,
    createInquiry: (...args: unknown[]) => mockCreateInquiry(...args),
    listInquiries: (...args: unknown[]) => mockListInquiries(...args),
  };
});

import { POST, GET } from "../route";
import { RentalError } from "@/modules/rental/service";

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/rental/inquiries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = { name: "Иван", phone: "+79001234567" };

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(null);
  mockRateLimit.mockResolvedValue(null);
  mockCreateInquiry.mockResolvedValue({ id: "inq-1" });
  mockProductEventCreate.mockRejectedValue(new Error("db down"));
});

describe("POST /api/rental/inquiries", () => {
  it("публично создаёт заявку без сессии — 201", async () => {
    const res = await POST(makeRequest(validBody));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(mockCreateInquiry).toHaveBeenCalledWith(validBody);
  });

  it("невалидное тело — 422, сервис не вызывается", async () => {
    const res = await POST(makeRequest({ name: "Иван" }));
    expect(res.status).toBe(422);
    expect(mockCreateInquiry).not.toHaveBeenCalled();
  });

  it("rate limit: 429 отдаётся как есть", async () => {
    const limited = new Response(null, { status: 429 });
    mockRateLimit.mockResolvedValue(limited as never);

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(429);
    expect(mockCreateInquiry).not.toHaveBeenCalled();
  });

  it("RentalError от сервиса прокидывается как есть", async () => {
    mockCreateInquiry.mockRejectedValue(new RentalError("OFFICE_NOT_FOUND", "Помещение не найдено"));

    const res = await POST(makeRequest(validBody));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("OFFICE_NOT_FOUND");
  });

  it("неожиданная ошибка сервиса — 500", async () => {
    mockCreateInquiry.mockRejectedValue(new Error("boom"));
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(500);
  });

  it("сбой записи в ProductEvent (БД недоступна) не ломает ответ заявки — fire-and-forget (AC-1.6)", async () => {
    const res = await POST(makeRequest(validBody));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(mockProductEventCreate).toHaveBeenCalledOnce();
  });
});

describe("GET /api/rental/inquiries", () => {
  it("требует админскую сессию — без неё отказ", async () => {
    const res = await GET(new NextRequest("http://localhost/api/rental/inquiries"));
    expect(res.status).not.toBe(200);
    expect(mockListInquiries).not.toHaveBeenCalled();
  });

  it("админ получает список заявок", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "SUPERADMIN" } });
    mockListInquiries.mockResolvedValue([{ id: "inq-1" }]);

    const res = await GET(new NextRequest("http://localhost/api/rental/inquiries"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([{ id: "inq-1" }]);
  });
});
