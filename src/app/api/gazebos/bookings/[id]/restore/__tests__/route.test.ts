import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockAuth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: () => mockAuth() }));

const mockRequireAdminSection = vi.fn();
vi.mock("@/lib/api-response", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-response")>("@/lib/api-response");
  return {
    ...actual,
    requireAdminSection: (...args: unknown[]) => mockRequireAdminSection(...args),
  };
});

const mockVerifyPassword = vi.fn();
vi.mock("@/lib/deletion", () => ({
  verifyUserPassword: (...args: unknown[]) => mockVerifyPassword(...args),
}));

const mockRestoreBooking = vi.fn();
vi.mock("@/modules/booking/restore", async () => {
  const actual = await vi.importActual<typeof import("@/modules/booking/restore")>(
    "@/modules/booking/restore"
  );
  return {
    ...actual,
    restoreBooking: (...args: unknown[]) => mockRestoreBooking(...args),
  };
});

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { POST } from "../route";
import { BookingRestoreError } from "@/modules/booking/restore";

const params = Promise.resolve({ id: "bk-1" });

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/gazebos/bookings/bk-1/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "su-1", role: "SUPERADMIN" } });
  mockRequireAdminSection.mockResolvedValue(null);
  mockVerifyPassword.mockResolvedValue({ ok: true });
  mockRestoreBooking.mockResolvedValue({ id: "bk-1", status: "CONFIRMED" });
});

describe("POST /api/gazebos/bookings/:id/restore", () => {
  it("восстанавливает бронь суперадмину с верным паролем", async () => {
    const res = await POST(makeRequest({ password: "hunter2", reason: "Ошибка смены" }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("CONFIRMED");
    expect(mockRestoreBooking).toHaveBeenCalledWith({
      bookingId: "bk-1",
      moduleSlug: "gazebos",
      actorId: "su-1",
      reason: "Ошибка смены",
    });
  });

  it("не пускает менеджера — восстановление только для суперадмина (AC-1)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "mgr-1", role: "MANAGER" } });

    const res = await POST(makeRequest({ password: "hunter2" }), { params });

    expect(res.status).toBe(403);
    expect(mockRestoreBooking).not.toHaveBeenCalled();
  });

  it("требует авторизацию", async () => {
    mockAuth.mockResolvedValue(null);

    const res = await POST(makeRequest({ password: "hunter2" }), { params });

    expect(res.status).toBe(401);
  });

  it("отклоняет неверный пароль, не трогая бронь (AC-7)", async () => {
    mockVerifyPassword.mockResolvedValue({ ok: false, reason: "INVALID" });

    const res = await POST(makeRequest({ password: "wrong" }), { params });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("INVALID_PASSWORD");
    expect(mockRestoreBooking).not.toHaveBeenCalled();
  });

  it("падает валидацией без пароля", async () => {
    const res = await POST(makeRequest({}), { params });

    expect(res.status).toBe(422);
    expect(mockRestoreBooking).not.toHaveBeenCalled();
  });

  it("занятый слот отдаёт 409, а не 500", async () => {
    mockRestoreBooking.mockRejectedValue(
      new BookingRestoreError("SLOT_TAKEN", "Слот уже занят другой бронью — восстановление невозможно")
    );

    const res = await POST(makeRequest({ password: "hunter2" }), { params });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error.code).toBe("SLOT_TAKEN");
  });

  it("истёкшее окно отдаёт 422 с понятным кодом", async () => {
    mockRestoreBooking.mockRejectedValue(
      new BookingRestoreError("RESTORE_WINDOW_EXPIRED", "Окно истекло")
    );

    const res = await POST(makeRequest({ password: "hunter2" }), { params });

    expect(res.status).toBe(422);
  });
});
