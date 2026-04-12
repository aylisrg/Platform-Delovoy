import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/admin-events", () => ({
  broadcastAdminEvent: vi.fn(),
}));

// Mock the dynamic import of service
vi.mock("../service", () => ({
  notify: vi.fn().mockResolvedValue(undefined),
}));

import { enqueueNotification } from "../queue";
import { broadcastAdminEvent } from "@/lib/admin-events";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("enqueueNotification", () => {
  it("broadcasts admin event via SSE for admin-routed events", () => {
    enqueueNotification({
      type: "booking.created",
      moduleSlug: "gazebos",
      entityId: "booking-1",
      userId: "user-1",
      actor: "client",
      data: {
        resourceName: "Беседка №1",
        date: "2026-04-15",
        startTime: "10:00",
        endTime: "12:00",
      },
    });

    expect(broadcastAdminEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "booking.created",
        moduleSlug: "gazebos",
        entityId: "booking-1",
        title: expect.stringContaining("Беседки"),
        body: expect.stringContaining("Беседка №1"),
      })
    );
  });

  it("does NOT broadcast for client-only events", () => {
    enqueueNotification({
      type: "booking.confirmed",
      moduleSlug: "gazebos",
      entityId: "booking-1",
      userId: "user-1",
      actor: "admin",
      data: {
        resourceName: "Беседка №1",
        date: "2026-04-15",
        startTime: "10:00",
        endTime: "12:00",
      },
    });

    // booking.confirmed is client-only (admin: false in events.ts)
    expect(broadcastAdminEvent).not.toHaveBeenCalled();
  });

  it("broadcasts order.placed to admin SSE", () => {
    enqueueNotification({
      type: "order.placed",
      moduleSlug: "cafe",
      entityId: "order-1",
      actor: "client",
      data: {
        orderNumber: "A123",
        totalAmount: "1500",
        userName: "Иванов",
        itemCount: 3,
      },
    });

    expect(broadcastAdminEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "order.placed",
        moduleSlug: "cafe",
        title: expect.stringContaining("Кафе"),
      })
    );
  });
});
