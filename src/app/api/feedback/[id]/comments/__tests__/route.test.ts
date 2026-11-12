import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: { feedbackItem: { findFirst: vi.fn() } },
}));
vi.mock("@/modules/feedback/service", () => ({
  addComment: vi.fn(),
  NotFoundError: class extends Error {},
}));
vi.mock("@/modules/analytics/dashboard-events", () => ({
  recordDashboardEvent: vi.fn(),
}));
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { addComment } from "@/modules/feedback/service";
import { POST } from "../route";
const request = (text = "Дополнение клиента") =>
  new NextRequest("http://localhost/api/feedback/f1/comments", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
const params = Promise.resolve({ id: "f1" });
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({
    user: { id: "owner", role: "USER" },
  } as never);
});
describe("customer replies", () => {
  it("allows the owner to reply and uses the session author", async () => {
    vi.mocked(prisma.feedbackItem.findFirst).mockResolvedValue({
      id: "f1",
    } as never);
    vi.mocked(addComment).mockResolvedValue({ id: "c1" } as never);
    expect((await POST(request(), { params })).status).toBe(201);
    expect(prisma.feedbackItem.findFirst).toHaveBeenCalledWith({
      where: { id: "f1", userId: "owner" },
      select: { id: true },
    });
    expect(addComment).toHaveBeenCalledWith(
      "f1",
      "owner",
      "Дополнение клиента",
    );
  });
  it("rejects another owner's feedback, including for staff without superadmin access", async () => {
    vi.mocked(prisma.feedbackItem.findFirst).mockResolvedValue(null);
    for (const role of ["USER", "MANAGER", "ADMIN"]) {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "other", role },
      } as never);
      expect((await POST(request(), { params })).status).toBe(404);
    }
    expect(addComment).not.toHaveBeenCalled();
  });
  it("preserves superadmin replies and validates comment size", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "staff", role: "SUPERADMIN" },
    } as never);
    expect((await POST(request("x".repeat(5001)), { params })).status).toBe(
      422,
    );
    expect(addComment).not.toHaveBeenCalled();
    expect((await POST(request(), { params })).status).toBe(201);
  });
});
