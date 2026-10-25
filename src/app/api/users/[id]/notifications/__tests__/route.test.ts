import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
const mockExplain = vi.fn();
vi.mock("@/modules/notifications/explain", () => ({ explainStaffNotifications: (...a: unknown[]) => mockExplain(...a) }));
const mockSet = vi.fn();
vi.mock("@/modules/notifications/subscriptions", () => ({ setStaffEventSubscription: (...a: unknown[]) => mockSet(...a) }));

import { auth } from "@/lib/auth";
import { NotificationDomainError } from "@/modules/notifications/errors";
import { GET, PATCH } from "../route";

const params = (id = "u1") => ({ params: Promise.resolve({ id }) });
const as = (role: string | null) =>
  vi.mocked(auth).mockResolvedValue((role ? { user: { id: "boss", role, adminSections: [] } } : null) as never);
const patch = (body: unknown) =>
  new Request("http://x", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const explain = {
  userId: "u1",
  categories: [{ events: [{ eventType: "booking.created", status: "RECEIVES", toggle: { enabled: true } }] }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockExplain.mockResolvedValue(new Map([["u1", explain]]));
  mockSet.mockResolvedValue({ eventType: "booking.created", enabled: true, before: null });
});

describe("GET /api/users/[id]/notifications (US-C1)", () => {
  it("SUPERADMIN gets the explanation; others 403; unknown user 404", async () => {
    as("SUPERADMIN");
    const res = await GET(new Request("http://x"), params());
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual(explain);
    as("MANAGER");
    expect((await GET(new Request("http://x"), params())).status).toBe(403);
    as("SUPERADMIN");
    mockExplain.mockResolvedValue(new Map());
    expect((await GET(new Request("http://x"), params("ghost"))).status).toBe(404);
  });
});

describe("PATCH /api/users/[id]/notifications (US-C2)", () => {
  it("AC-C2.4: writes via the shared path with the actor; matrix clicks are tagged", async () => {
    as("SUPERADMIN");
    const res = await PATCH(patch({ eventType: "booking.created", enabled: true }), params());
    expect(res.status).toBe(200);
    expect(mockSet).toHaveBeenCalledWith({
      targetUserId: "u1", eventType: "booking.created", enabled: true, actor: { userId: "boss", via: "admin" },
    });
    expect((await res.json()).data).toMatchObject({ eventType: "booking.created", status: "RECEIVES" });

    await PATCH(patch({ eventType: "booking.created", enabled: false, source: "matrix" }), params());
    expect(mockSet).toHaveBeenLastCalledWith(expect.objectContaining({ actor: { userId: "boss", via: "matrix" } }));
  });

  it("AC-C2.7: ADMIN / MANAGER / USER can't change someone else's notifications", async () => {
    for (const role of ["ADMIN", "MANAGER", "USER"]) {
      as(role);
      expect((await PATCH(patch({ eventType: "booking.created", enabled: true }), params())).status).toBe(403);
    }
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("AC-C2.6: unknown type → 422 by Zod; no access → 422 from the service", async () => {
    as("SUPERADMIN");
    expect((await PATCH(patch({ eventType: "health.critical", enabled: true }), params())).status).toBe(422);
    mockSet.mockRejectedValue(new NotificationDomainError("NO_ACCESS_TO_CATEGORY", "Нет доступа к разделу «Кафе»", 422));
    const res = await PATCH(patch({ eventType: "order.placed", enabled: true }), params());
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatchObject({ code: "NO_ACCESS_TO_CATEGORY", message: "Нет доступа к разделу «Кафе»" });
  });
});
