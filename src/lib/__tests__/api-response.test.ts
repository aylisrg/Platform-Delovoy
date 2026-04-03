import { describe, it, expect, vi } from "vitest";

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

import {
  apiResponse,
  apiError,
  apiNotFound,
  apiForbidden,
  apiUnauthorized,
  apiValidationError,
  apiServerError,
} from "@/lib/api-response";

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
