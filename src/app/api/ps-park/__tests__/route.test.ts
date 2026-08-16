import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockAuth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: () => mockAuth() }));

const mockCanEditModule = vi.fn();
vi.mock("@/lib/permissions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  return {
    ...actual,
    canEditModule: (...args: unknown[]) => mockCanEditModule(...args),
  };
});

const mockLogAudit = vi.fn();
vi.mock("@/lib/logger", () => ({
  logAudit: (...args: unknown[]) => mockLogAudit(...args),
}));

const mockListTables = vi.fn();
const mockCreateTable = vi.fn();
vi.mock("@/modules/ps-park/service", async () => {
  const actual = await vi.importActual<typeof import("@/modules/ps-park/service")>(
    "@/modules/ps-park/service"
  );
  return {
    ...actual,
    listTables: (...args: unknown[]) => mockListTables(...args),
    createTable: (...args: unknown[]) => mockCreateTable(...args),
  };
});

import { GET, POST } from "../route";

function makeGetRequest(query = "") {
  return new NextRequest(`http://localhost/api/ps-park${query}`);
}

function makePostRequest(body: unknown) {
  return new NextRequest("http://localhost/api/ps-park", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "mgr-1", role: "MANAGER" } });
  mockCanEditModule.mockResolvedValue(true);
  mockListTables.mockResolvedValue([]);
  mockCreateTable.mockResolvedValue({ id: "table-new", name: "Стол №5" });
});

describe("GET /api/ps-park", () => {
  it("отдаёт активные столы без авторизации (публичный роут)", async () => {
    mockAuth.mockResolvedValue(null);
    mockListTables.mockResolvedValue([{ id: "t-1" }]);

    const res = await GET(makeGetRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([{ id: "t-1" }]);
    expect(mockListTables).toHaveBeenCalledWith(true);
  });

  it("?all=true передаёт activeOnly=false", async () => {
    await GET(makeGetRequest("?all=true"));

    expect(mockListTables).toHaveBeenCalledWith(false);
  });
});

describe("POST /api/ps-park (issue #667)", () => {
  const validBody = { name: "Стол №5", capacity: 6, pricePerHour: 400 };

  it("создаёт стол при наличии прав редактирования модуля", async () => {
    const res = await POST(makePostRequest(validBody));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(mockCreateTable).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Стол №5", capacity: 6, pricePerHour: 400 })
    );
    expect(mockLogAudit).toHaveBeenCalledWith(
      "mgr-1",
      "ps-park.resource.create",
      "Resource",
      "table-new",
      expect.any(Object)
    );
  });

  it("требует авторизацию — 401", async () => {
    mockAuth.mockResolvedValue(null);

    const res = await POST(makePostRequest(validBody));

    expect(res.status).toBe(401);
    expect(mockCreateTable).not.toHaveBeenCalled();
  });

  it("без права редактирования модуля — 403", async () => {
    mockCanEditModule.mockResolvedValue(false);

    const res = await POST(makePostRequest(validBody));

    expect(res.status).toBe(403);
    expect(mockCreateTable).not.toHaveBeenCalled();
    expect(mockCanEditModule).toHaveBeenCalledWith(expect.objectContaining({ id: "mgr-1" }), "ps-park");
  });

  it("отклоняет тело без названия — 422, сервис не вызван", async () => {
    const res = await POST(makePostRequest({ capacity: 5 }));

    expect(res.status).toBe(422);
    expect(mockCreateTable).not.toHaveBeenCalled();
  });

  it("создаёт стол без опциональных полей — только name обязателен (AC-2)", async () => {
    const res = await POST(makePostRequest({ name: "Стол минимальный" }));

    expect(res.status).toBe(201);
    expect(mockCreateTable).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Стол минимальный" })
    );
  });

  it("неожиданная ошибка сервиса — 500, без утечки деталей", async () => {
    mockCreateTable.mockRejectedValue(new Error("boom"));

    const res = await POST(makePostRequest(validBody));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });
});
