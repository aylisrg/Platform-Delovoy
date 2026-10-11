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
    expect(result!.title).toContain("нужно подтвердить");
    expect(result!.body).toContain("Беседка №1");
    expect(result!.body).toContain("ср, 15 апреля · 10:00–12:00");
  });

  it("booking.created из бота — «ждёт оплаты», а не «нужно подтвердить»", () => {
    const result = renderBrowserNotification("gazebos", "booking.created", {
      resourceName: "Беседка №1",
      date: "2026-04-15",
      startTime: "10:00",
      endTime: "12:00",
      paymentFlow: "link",
    });
    expect(result!.title).toContain("ждёт оплаты");
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
    expect(result!.body).toContain("1\u00a0500 ₽");
    expect(result!.body).toContain("самовывоз");
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
    expect(result!.title).toContain("заканчивается");
    expect(result!.body).toContain("ООО Тест");
    expect(result!.body).toContain("через 15 дней");
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

  it("оплата брони беседки звенит в колокольчике (до оплаты бронь персоналу не видна)", () => {
    const result = renderBrowserNotification("gazebos", "payment.succeeded", {
      amount: "4 000,00",
      description: "Беседка: Беседка №1, 2026-10-10 16:00–22:00",
      subjectType: "BOOKING",
    });
    expect(result!.title).toBe("Барбекю Парк: бронь оплачена");
    expect(result!.body).toBe("Беседка: Беседка №1, сб, 10 октября 16:00–22:00 · 4 000,00 ₽");
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
    expect(result!.title).toContain("бронь отменена");
  });
});
