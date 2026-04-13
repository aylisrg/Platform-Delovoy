import { describe, it, expect } from "vitest";
import { renderBrowserNotification } from "../browser-templates";

describe("renderBrowserNotification", () => {
  it("renders gazebos booking.created", () => {
    const result = renderBrowserNotification("gazebos", "booking.created", {
      resourceName: "Беседка №1",
      date: "2026-04-15",
      startTime: "10:00",
      endTime: "12:00",
    });
    expect(result).not.toBeNull();
    expect(result!.title).toContain("Барбекю Парк");
    expect(result!.body).toContain("Беседка №1");
  });

  it("renders ps-park booking.created", () => {
    const result = renderBrowserNotification("ps-park", "booking.created", {
      resourceName: "Стол PS5 №2",
      date: "2026-04-15",
      startTime: "14:00",
      endTime: "16:00",
    });
    expect(result).not.toBeNull();
    expect(result!.title).toContain("Плей Парк");
    expect(result!.body).toContain("Стол PS5 №2");
  });

  it("renders cafe order.placed", () => {
    const result = renderBrowserNotification("cafe", "order.placed", {
      orderNumber: "A123",
      totalAmount: "1500",
    });
    expect(result).not.toBeNull();
    expect(result!.title).toContain("Кафе");
    expect(result!.body).toContain("A123");
    expect(result!.body).toContain("1500");
  });

  it("renders cafe order.placed with delivery", () => {
    const result = renderBrowserNotification("cafe", "order.placed", {
      orderNumber: "B456",
      totalAmount: "800",
      deliveryTo: "301",
    });
    expect(result!.body).toContain("301");
  });

  it("renders rental contract.expiring", () => {
    const result = renderBrowserNotification("rental", "contract.expiring", {
      tenantName: "ООО Тест",
      officeNumber: "A-12",
      daysLeft: 15,
    });
    expect(result).not.toBeNull();
    expect(result!.title).toContain("истекает");
    expect(result!.body).toContain("ООО Тест");
    expect(result!.body).toContain("15");
  });

  it("renders rental inquiry.created", () => {
    const result = renderBrowserNotification("rental", "inquiry.created", {
      name: "Петров",
      phone: "+7 900 000-00-00",
      officeNumber: "B-5",
    });
    expect(result).not.toBeNull();
    expect(result!.body).toContain("Петров");
    expect(result!.body).toContain("B-5");
  });

  it("returns null for unknown module", () => {
    expect(renderBrowserNotification("unknown", "booking.created", {})).toBeNull();
  });

  it("returns null for unknown event type", () => {
    expect(renderBrowserNotification("gazebos", "unknown.event", {})).toBeNull();
  });

  it("renders cancelled events", () => {
    const result = renderBrowserNotification("gazebos", "booking.cancelled", {
      resourceName: "Беседка №3",
      date: "2026-04-20",
      startTime: "18:00",
      endTime: "20:00",
    });
    expect(result).not.toBeNull();
    expect(result!.title).toContain("отменено");
  });
});
