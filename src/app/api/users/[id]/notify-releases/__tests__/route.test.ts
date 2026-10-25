import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
const mockSet = vi.fn();
vi.mock("@/modules/notifications/subscriptions", () => ({ setStaffEventSubscription: (...a: unknown[]) => mockSet(...a) }));

import { auth } from "@/lib/auth";
import { NotificationDomainError } from "@/modules/notifications/errors";
import { PATCH } from "../route";

const params = (id = "u1") => ({ params: Promise.resolve({ id }) });
const as = (role: string | null) =>
  vi.mocked(auth).mockResolvedValue((role ? { user: { id: "boss", role } } : null) as never);
const patch = (body: string) =>
  new Request("http://x", { method: "PATCH", headers: { "Content-Type": "application/json" }, body });

beforeEach(() => {
  vi.clearAllMocks();
  mockSet.mockResolvedValue({ eventType: "system.release", enabled: true, before: null });
});

describe("PATCH /api/users/[id]/notify-releases", () => {
  it("SUPERADMIN toggles through the shared subscription path with the actor", async () => {
    as("SUPERADMIN");
    const res = await PATCH(patch(JSON.stringify({ enabled: true })), params());
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ notifyReleases: true });
    expect(mockSet).toHaveBeenCalledWith({
      targetUserId: "u1", eventType: "system.release", enabled: true, actor: { userId: "boss", via: "admin" },
    });
  });

  it("broken JSON or a wrong body → 400 VALIDATION_ERROR, never 500 (QA BUG-3)", async () => {
    as("SUPERADMIN");
    for (const body of ["{not json", JSON.stringify({ enabled: "yes" })]) {
      const res = await PATCH(patch(body), params());
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    }
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("401 anonymous, 403 for non-SUPERADMIN; unknown user 404", async () => {
    as(null);
    expect((await PATCH(patch(JSON.stringify({ enabled: true })), params())).status).toBe(401);
    as("ADMIN");
    expect((await PATCH(patch(JSON.stringify({ enabled: true })), params())).status).toBe(403);
    as("SUPERADMIN");
    mockSet.mockRejectedValue(new NotificationDomainError("USER_NOT_FOUND", "nope", 404));
    expect((await PATCH(patch(JSON.stringify({ enabled: true })), params("ghost"))).status).toBe(404);
  });
});
