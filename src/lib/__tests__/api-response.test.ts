import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock next/server before importing the module under test
vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      _body: body,
      async json() {
        return body;
      },
    })),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    adminPermission: { findUnique: vi.fn() },
  },
}));

import {
  apiResponse,
  apiError,
  apiNotFound,
  apiForbidden,
  apiUnauthorized,
  apiValidationError,
  apiServerError,
  requireAdminSection,
} from "@/lib/api-response";
import { prisma } from "@/lib/db";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("apiResponse", () => {
  it("returns success:true with data", async () => {
    const res = apiResponse({ id: "1", name: "test" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ id: "1", name: "test" });
    expect(body.meta).toBeUndefined();
  });

  it("includes meta when provided", async () => {
    const res = apiResponse([1, 2, 3], { page: 1, perPage: 10, total: 3 });
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.meta).toEqual({ page: 1, perPage: 10, total: 3 });
  });

  it("uses custom status code", async () => {
    const res = apiResponse({ created: true }, undefined, 201);
    expect(res.status).toBe(201);
  });
});

describe("apiError", () => {
  it("returns success:false with code and message", async () => {
    const res = apiError("SOME_ERROR", "Something went wrong", 400);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("SOME_ERROR");
    expect(body.error.message).toBe("Something went wrong");
  });

  it("defaults to status 400", async () => {
    const res = apiError("ERR", "msg");
    expect(res.status).toBe(400);
  });
});

describe("apiNotFound", () => {
  it("returns 404 with NOT_FOUND code", async () => {
    const res = apiNotFound();
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("accepts custom message", async () => {
    const res = apiNotFound("Пользователь не найден");
    const body = await res.json();
    expect(body.error.message).toBe("Пользователь не найден");
  });
});

describe("apiForbidden", () => {
  it("returns 403 with FORBIDDEN code", async () => {
    const res = apiForbidden();
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });
});

describe("apiUnauthorized", () => {
  it("returns 401 with UNAUTHORIZED code", async () => {
    const res = apiUnauthorized();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });
});

describe("apiValidationError", () => {
  it("returns 422 with VALIDATION_ERROR code", async () => {
    const res = apiValidationError("Поле обязательно");
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toBe("Поле обязательно");
  });
});

describe("apiServerError", () => {
  it("returns 500 with INTERNAL_ERROR code", async () => {
    const res = apiServerError();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });

  it("accepts custom message", async () => {
    const res = apiServerError("Database error");
    const body = await res.json();
    expect(body.error.message).toBe("Database error");
  });
});

describe("requireAdminSection", () => {
  it("returns 401 when no session", async () => {
    const res = await requireAdminSection(null, "gazebos");
    expect(res).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((res as any).status).toBe(401);
  });

  it("allows SUPERADMIN into any section", async () => {
    const res = await requireAdminSection(
      { user: { id: "sa", role: "SUPERADMIN" } },
      "rental"
    );
    expect(res).toBeNull();
    expect(prisma.adminPermission.findUnique).not.toHaveBeenCalled();
  });

  it("allows ADMIN into gazebos by role alone", async () => {
    const res = await requireAdminSection(
      { user: { id: "a1", role: "ADMIN" } },
      "gazebos"
    );
    expect(res).toBeNull();
    expect(prisma.adminPermission.findUnique).not.toHaveBeenCalled();
  });

  it("allows ADMIN into ps-park by role alone", async () => {
    const res = await requireAdminSection(
      { user: { id: "a1", role: "ADMIN" } },
      "ps-park"
    );
    expect(res).toBeNull();
  });

  it("allows ADMIN into inventory by role alone", async () => {
    const res = await requireAdminSection(
      { user: { id: "a1", role: "ADMIN" } },
      "inventory"
    );
    expect(res).toBeNull();
  });

  it("requires AdminPermission for ADMIN in other sections", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "ADMIN" } as never);
    vi.mocked(prisma.adminPermission.findUnique).mockResolvedValue(null);
    const res = await requireAdminSection(
      { user: { id: "a1", role: "ADMIN" } },
      "rental"
    );
    expect(res).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((res as any).status).toBe(403);
  });

  it("grants ADMIN with AdminPermission in non-editable section", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "ADMIN" } as never);
    vi.mocked(prisma.adminPermission.findUnique).mockResolvedValue({
      id: "p1", userId: "a1", section: "rental",
    } as never);
    const res = await requireAdminSection(
      { user: { id: "a1", role: "ADMIN" } },
      "rental"
    );
    expect(res).toBeNull();
  });

  it("forbids USER role outright", async () => {
    const res = await requireAdminSection(
      { user: { id: "u1", role: "USER" } },
      "gazebos"
    );
    expect(res).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((res as any).status).toBe(403);
  });

  it("requires AdminPermission for MANAGER", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "MANAGER" } as never);
    vi.mocked(prisma.adminPermission.findUnique).mockResolvedValue(null);
    const res = await requireAdminSection(
      { user: { id: "m1", role: "MANAGER" } },
      "gazebos"
    );
    expect(res).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((res as any).status).toBe(403);
  });

  it("grants MANAGER when AdminPermission present", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "MANAGER" } as never);
    vi.mocked(prisma.adminPermission.findUnique).mockResolvedValue({
      id: "p1", userId: "m1", section: "gazebos",
    } as never);
    const res = await requireAdminSection(
      { user: { id: "m1", role: "MANAGER" } },
      "gazebos"
    );
    expect(res).toBeNull();
  });
});
