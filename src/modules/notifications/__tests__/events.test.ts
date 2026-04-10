import { describe, it, expect } from "vitest";
import { EVENT_ROUTING } from "../events";

describe("EVENT_ROUTING", () => {
  it("booking.created goes to admin only", () => {
    expect(EVENT_ROUTING["booking.created"]).toEqual({
      client: false,
      admin: true,
      category: "booking",
    });
  });

  it("booking.confirmed goes to client only", () => {
    expect(EVENT_ROUTING["booking.confirmed"]).toEqual({
      client: true,
      admin: false,
      category: "booking",
    });
  });

  it("booking.cancelled goes to both", () => {
    expect(EVENT_ROUTING["booking.cancelled"]).toEqual({
      client: true,
      admin: true,
      category: "booking",
    });
  });

  it("order.placed goes to admin only", () => {
    expect(EVENT_ROUTING["order.placed"]).toEqual({
      client: false,
      admin: true,
      category: "order",
    });
  });

  it("order.ready goes to client only", () => {
    expect(EVENT_ROUTING["order.ready"]).toEqual({
      client: true,
      admin: false,
      category: "order",
    });
  });

  it("contract.created goes to admin only", () => {
    expect(EVENT_ROUTING["contract.created"]).toEqual({
      client: false,
      admin: true,
    });
  });

  it("all event types have routing defined", () => {
    const expectedEvents = [
      "booking.created", "booking.confirmed", "booking.cancelled", "booking.reminder",
      "order.placed", "order.preparing", "order.ready", "order.delivered", "order.cancelled",
      "contract.created", "contract.expiring",
    ];
    for (const event of expectedEvents) {
      expect(EVENT_ROUTING[event], `${event} should be defined`).toBeDefined();
    }
  });
});
