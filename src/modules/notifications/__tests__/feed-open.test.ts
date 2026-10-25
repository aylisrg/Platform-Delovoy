import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    outgoingNotification: { findFirst: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    inAppNotification: { findFirst: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    broadcastCampaign: { findMany: vi.fn() },
    notificationGlobalPreference: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
import { markFeedRead, openFeedItem } from "../feed";

const withAction = { title: "Новая бронь", body: "…", actions: [{ label: "Открыть", url: "/admin/gazebos" }] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.outgoingNotification.updateMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(prisma.inAppNotification.updateMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(prisma.outgoingNotification.count).mockResolvedValue(0);
  vi.mocked(prisma.inAppNotification.count).mockResolvedValue(0);
  vi.mocked(prisma.broadcastCampaign.findMany).mockResolvedValue([]);
  vi.mocked(prisma.notificationGlobalPreference.findUnique).mockResolvedValue(null);
});

describe("openFeedItem — read + click = one reaction (AC-D3.10)", () => {
  it("followed action: readVia=open on the row, click on the chain root", async () => {
    vi.mocked(prisma.outgoingNotification.findFirst).mockResolvedValue({
      id: "fb-2", fallbackOfId: "root-1", readAt: null, payload: withAction,
    } as never);

    const res = await openFeedItem("u1", { id: "on:fb-2", actionIndex: 0 });
    expect(res.clicked).toBe(true);
    expect(prisma.outgoingNotification.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "fb-2", userId: "u1" } }));
    expect(prisma.outgoingNotification.updateMany).toHaveBeenCalledWith({
      where: { id: "fb-2", userId: "u1", readAt: null },
      data: { readAt: expect.any(Date), readVia: "open" },
    });
    expect(prisma.outgoingNotification.updateMany).toHaveBeenCalledWith({
      where: { id: "root-1", userId: "u1", clickedAt: null },
      data: { clickedAt: expect.any(Date) },
    });
    expect(prisma.outgoingNotification.updateMany).toHaveBeenCalledWith({
      where: { id: "root-1", userId: "u1" },
      data: { clickCount: { increment: 1 } },
    });
  });

  it("tap without navigation is only read; already read keeps its readAt", async () => {
    const readAt = new Date("2026-10-20T10:00:00Z");
    vi.mocked(prisma.outgoingNotification.findFirst).mockResolvedValue({
      id: "on-1", fallbackOfId: null, readAt, payload: { title: "t", body: "b" },
    } as never);
    const res = await openFeedItem("u1", { id: "on:on-1" });
    expect(res).toEqual({ readAt: readAt.toISOString(), clicked: false });
    expect(prisma.outgoingNotification.updateMany).not.toHaveBeenCalled();
  });

  it("stored actions alone don't count as a click (read-only summary cards)", async () => {
    vi.mocked(prisma.outgoingNotification.findFirst).mockResolvedValue({
      id: "on-1", fallbackOfId: null, readAt: null, payload: withAction,
    } as never);
    expect((await openFeedItem("u1", { id: "on:on-1" })).clicked).toBe(false);
  });

  it("someone else's id finds nothing and writes nothing", async () => {
    vi.mocked(prisma.outgoingNotification.findFirst).mockResolvedValue(null);
    expect(await openFeedItem("u1", { id: "on:foreign" })).toEqual({ readAt: null, clicked: false });
    expect(prisma.outgoingNotification.updateMany).not.toHaveBeenCalled();
  });

  it("in-app item re-checks access and records read + click on itself", async () => {
    vi.mocked(prisma.inAppNotification.findFirst).mockResolvedValue({ id: "ia-1", readAt: null, payload: withAction } as never);
    const res = await openFeedItem("u1", { id: "ia:ia-1", actionIndex: 0 });
    expect(res.clicked).toBe(true);
    expect(prisma.inAppNotification.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "ia-1", userId: "u1", user: { role: "SUPERADMIN", mergedIntoUserId: null } }),
    }));
    expect(prisma.inAppNotification.updateMany).toHaveBeenCalledWith({
      where: { id: "ia-1", userId: "u1", readAt: null },
      data: { readAt: expect.any(Date), readVia: "open" },
    });
  });

  it("unknown prefix is ignored", async () => {
    expect(await openFeedItem("u1", { id: "zz:1" })).toEqual({ readAt: null, clicked: false });
  });
});

describe("markFeedRead — readVia (ADR 2026-10-25 §Q3)", () => {
  it("explicit ids are 'mark', «Прочитать всё» is 'bulk' (not a reaction)", async () => {
    await markFeedRead("u1", { ids: ["on:a", "ia:b"], upTo: "2026-10-25T10:00:00.000Z" });
    const outgoing = vi.mocked(prisma.outgoingNotification.updateMany).mock.calls.map((c) => c[0]);
    expect(outgoing).toContainEqual({ where: { userId: "u1", id: { in: ["a"] }, readAt: null }, data: { readAt: expect.any(Date), readVia: "mark" } });
    expect(outgoing).toContainEqual(expect.objectContaining({ data: { readAt: expect.any(Date), readVia: "bulk" } }));
    const inApp = vi.mocked(prisma.inAppNotification.updateMany).mock.calls.map((c) => c[0]);
    expect(inApp).toContainEqual(expect.objectContaining({ where: expect.objectContaining({ id: { in: ["b"] } }), data: { readAt: expect.any(Date), readVia: "mark" } }));
    expect(inApp).toContainEqual(expect.objectContaining({ data: { readAt: expect.any(Date), readVia: "bulk" } }));
  });
});
