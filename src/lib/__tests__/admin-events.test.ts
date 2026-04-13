import { describe, it, expect, vi } from "vitest";
import {
  broadcastAdminEvent,
  subscribeAdminEvents,
  type AdminBrowserEvent,
} from "@/lib/admin-events";

const mockEvent: AdminBrowserEvent = {
  id: "test-1",
  type: "booking.created",
  moduleSlug: "gazebos",
  entityId: "booking-123",
  title: "Новое бронирование — Барбекю Парк",
  body: "Беседка №1\n2026-04-15 10:00–12:00",
  timestamp: new Date().toISOString(),
};

describe("admin-events broadcaster", () => {
  it("delivers events to subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAdminEvents(listener);

    broadcastAdminEvent(mockEvent);

    expect(listener).toHaveBeenCalledWith(mockEvent);
    unsubscribe();
  });

  it("stops delivering after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAdminEvents(listener);

    unsubscribe();
    broadcastAdminEvent(mockEvent);

    expect(listener).not.toHaveBeenCalled();
  });

  it("delivers to multiple subscribers", () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    const unsub1 = subscribeAdminEvents(listener1);
    const unsub2 = subscribeAdminEvents(listener2);

    broadcastAdminEvent(mockEvent);

    expect(listener1).toHaveBeenCalledWith(mockEvent);
    expect(listener2).toHaveBeenCalledWith(mockEvent);

    unsub1();
    unsub2();
  });

  it("only unsubscribes the specific listener", () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    const unsub1 = subscribeAdminEvents(listener1);
    const unsub2 = subscribeAdminEvents(listener2);

    unsub1();
    broadcastAdminEvent(mockEvent);

    expect(listener1).not.toHaveBeenCalled();
    expect(listener2).toHaveBeenCalledWith(mockEvent);

    unsub2();
  });
});
