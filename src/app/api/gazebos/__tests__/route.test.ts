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

const mockListResources = vi.fn();
const mockCreateResource = vi.fn();
vi.mock("@/modules/gazebos/service", async () => {
  const actual = await vi.importActual<typeof import("@/modules/gazebos/service")>(
    "@/modules/gazebos/service"
  );
  return {
    ...actual,
    listResources: (...args: unknown[]) => mockListResources(...args),
    createResource: (...args: unknown[]) => mockCreateResource(...args),
  };
});

import { GET, POST } from "../route";

function makeGetRequest(query = "") {
  return new NextRequest(`http://localhost/api/gazebos${query}`);
}

function makePostRequest(body: unknown) {
  return new NextRequest("http://localhost/api/gazebos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "mgr-1", role: "MANAGER" } });
  mockCanEditModule.mockResolvedValue(true);
  mockListResources.mockResolvedValue([]);
  mockCreateResource.mockResolvedValue({ id: "resource-new", name: "Беседка №5" });
});

describe("GET /api/gazebos", () => {
  it("отдаёт активные ресурсы без авторизации (публичный роут)", async () => {
    mockAuth.mockResolvedValue(null);
    mockListResources.mockResolvedValue([{ id: "r-1" }]);

    const res = await GET(makeGetRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([{ id: "r-1" }]);
    expect(mockListResources).toHaveBeenCalledWith(true);
  });

  it("?all=true передаёт activeOnly=false", async () => {
    await GET(makeGetRequest("?all=true"));

    expect(mockListResources).toHaveBeenCalledWith(false);
  });
});

describe("POST /api/gazebos (issue #667)", () => {
  const validBody = { name: "Беседка №5", capacity: 12, pricePerHour: 700 };

  it("создаёт ресурс при наличии прав редактирования модуля", async () => {
    const res = await POST(makePostRequest(validBody));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(mockCreateResource).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Беседка №5", capacity: 12, pricePerHour: 700 })
    );
    expect(mockLogAudit).toHaveBeenCalledWith(
      "mgr-1",
      "gazebos.resource.create",
      "Resource",
      "resource-new",
      expect.any(Object)
    );
  });

  it("требует авторизацию — 401", async () => {
    mockAuth.mockResolvedValue(null);

    const res = await POST(makePostRequest(validBody));

    expect(res.status).toBe(401);
    expect(mockCreateResource).not.toHaveBeenCalled();
  });

  it("без права редактирования модуля — 403", async () => {
    mockCanEditModule.mockResolvedValue(false);

    const res = await POST(makePostRequest(validBody));

    expect(res.status).toBe(403);
    expect(mockCreateResource).not.toHaveBeenCalled();
    expect(mockCanEditModule).toHaveBeenCalledWith(expect.objectContaining({ id: "mgr-1" }), "gazebos");
  });

  it("отклоняет тело без названия — 422, сервис не вызван", async () => {
    const res = await POST(makePostRequest({ capacity: 5 }));

    expect(res.status).toBe(422);
    expect(mockCreateResource).not.toHaveBeenCalled();
  });

  it("создаёт ресурс без опциональных полей — только name обязателен (AC-2)", async () => {
    const res = await POST(makePostRequest({ name: "Беседка минимальная" }));

    expect(res.status).toBe(201);
    expect(mockCreateResource).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Беседка минимальная" })
    );
  });

  it("неожиданная ошибка сервиса — 500, без утечки деталей", async () => {
    mockCreateResource.mockRejectedValue(new Error("boom"));

    const res = await POST(makePostRequest(validBody));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });
});
