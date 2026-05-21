import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    broadcastCampaign: {
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/modules/notifications/dispatch/dispatcher", () => ({
  dispatch: vi.fn(),
}));

vi.mock("../segments", () => ({
  SEGMENT_RESOLVERS: {
    all_verified_users: vi.fn(),
    active_office_tenants: vi.fn(),
    ps_park_guests_90d: vi.fn(),
    gazebo_guests_180d: vi.fn(),
  },
}));

vi.mock("@/lib/logger", () => ({ logAudit: vi.fn() }));

import { prisma } from "@/lib/db";
import { dispatch } from "@/modules/notifications/dispatch/dispatcher";
import { logAudit } from "@/lib/logger";
import { SEGMENT_RESOLVERS } from "../segments";
import { broadcastToSegment } from "../broadcast";

const mockCampaign = { id: "camp-1", segmentKey: "all_verified_users", total: 2, sent: 0, failed: 0, status: "running", payload: {}, createdBy: "admin-1", createdAt: new Date(), eventType: "BROADCAST" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.broadcastCampaign.create).mockResolvedValue(mockCampaign as never);
  vi.mocked(prisma.broadcastCampaign.update).mockResolvedValue({} as never);
});

describe("broadcastToSegment", () => {
  it("queues messages for all users in segment", async () => {
    vi.mocked(SEGMENT_RESOLVERS.all_verified_users).mockResolvedValueOnce(["u-1", "u-2"]);
    vi.mocked(dispatch).mockResolvedValue({ status: "queued", outgoingId: "n-1" } as never);

    const result = await broadcastToSegment(
      { segmentKey: "all_verified_users", title: "Test", body: "Hello" },
      "admin-1"
    );

    expect(result.total).toBe(2);
    expect(result.sent).toBe(2);
    expect(result.failed).toBe(0);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u-1", eventType: "BROADCAST" })
    );
  });

  it("counts skipped dispatches as failed", async () => {
    vi.mocked(SEGMENT_RESOLVERS.all_verified_users).mockResolvedValueOnce(["u-1", "u-2"]);
    vi.mocked(dispatch)
      .mockResolvedValueOnce({ status: "queued", outgoingId: "n-1" } as never)
      .mockResolvedValueOnce({ status: "skipped", reason: "no available channel" } as never);

    const result = await broadcastToSegment(
      { segmentKey: "all_verified_users", title: "T", body: "B" },
      "admin-1"
    );

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
  });

  it("marks campaign as completed at end", async () => {
    vi.mocked(SEGMENT_RESOLVERS.all_verified_users).mockResolvedValueOnce(["u-1"]);
    vi.mocked(dispatch).mockResolvedValue({ status: "queued", outgoingId: "n-1" } as never);

    await broadcastToSegment(
      { segmentKey: "all_verified_users", title: "T", body: "B" },
      "admin-1"
    );

    const lastUpdate = vi.mocked(prisma.broadcastCampaign.update).mock.calls.at(-1)?.[0] as { data: { status: string } };
    expect(lastUpdate?.data?.status).toBe("completed");
  });

  it("returns empty result for empty segment", async () => {
    vi.mocked(SEGMENT_RESOLVERS.all_verified_users).mockResolvedValueOnce([]);
    const result = await broadcastToSegment(
      { segmentKey: "all_verified_users", title: "T", body: "B" },
      "admin-1"
    );
    expect(result.total).toBe(0);
    expect(result.sent).toBe(0);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("logs audit event on broadcast.create", async () => {
    vi.mocked(SEGMENT_RESOLVERS.all_verified_users).mockResolvedValueOnce(["u-1"]);
    vi.mocked(dispatch).mockResolvedValue({ status: "queued", outgoingId: "n-1" } as never);

    await broadcastToSegment(
      { segmentKey: "all_verified_users", title: "T", body: "B" },
      "admin-1"
    );

    expect(logAudit).toHaveBeenCalledWith(
      "admin-1",
      "broadcast.create",
      "BroadcastCampaign",
      "camp-1",
      expect.objectContaining({ segmentKey: "all_verified_users" })
    );
  });
});
