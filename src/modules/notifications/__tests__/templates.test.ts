import { describe, it, expect } from "vitest";
import {
  renderClientMessage,
  renderAdminMessage,
  clientTemplates,
  adminTemplates,
} from "../templates";

describe("renderClientMessage", () => {
  it("renders gazebos booking.confirmed", () => {
    const msg = renderClientMessage("gazebos", "booking.confirmed", {
      resourceName: "Беседка №1",
      date: "2026-04-15",
      startTime: "10:00",
      endTime: "12:00",
    });
    expect(msg).toContain("Бронирование подтверждено");
    expect(msg).toContain("Беседка №1");
    expect(msg).toContain("10:00");
  });

  it("renders cafe order.ready with deliveryTo", () => {
    const msg = renderClientMessage("cafe", "order.ready", {
      orderNumber: "ABC123",
      deliveryTo: "301",
    });
    expect(msg).toContain("ABC123");
    expect(msg).toContain("готов");
    expect(msg).toContain("301");
  });

  it("returns null for unknown module", () => {
    expect(renderClientMessage("unknown", "booking.confirmed", {})).toBeNull();
  });

  it("returns null for unknown event", () => {
    expect(renderClientMessage("gazebos", "unknown.event", {})).toBeNull();
  });
});

describe("renderAdminMessage", () => {
  it("renders gazebos booking.created", () => {
    const msg = renderAdminMessage("gazebos", "booking.created", {
      resourceName: "Беседка №2",
      date: "2026-04-16",
      startTime: "14:00",
      endTime: "16:00",
      userName: "Иван Петров",
    });
    expect(msg).toContain("Новое бронирование");
    expect(msg).toContain("Иван Петров");
    expect(msg).toContain("подтверждение");
  });

  it("renders cafe order.placed", () => {
    const msg = renderAdminMessage("cafe", "order.placed", {
      orderNumber: "XYZ789",
      userName: "Мария",
      totalAmount: "1500",
      itemCount: 3,
    });
    expect(msg).toContain("Новый заказ");
    expect(msg).toContain("1500");
  });

  it("renders rental contract.expiring", () => {
    const msg = renderAdminMessage("rental", "contract.expiring", {
      tenantName: "ООО Тест",
      officeNumber: "A-12",
      endDate: "2026-05-10",
      daysLeft: 15,
    });
    expect(msg).toContain("истекает");
    expect(msg).toContain("ООО Тест");
    expect(msg).toContain("15");
  });
});

describe("template coverage", () => {
  it("all client templates produce non-empty strings", () => {
    for (const [module, events] of Object.entries(clientTemplates)) {
      for (const [event, fn] of Object.entries(events)) {
        const result = fn({
          resourceName: "Test",
          date: "2026-01-01",
          startTime: "10:00",
          endTime: "11:00",
          orderNumber: "T123",
          deliveryTo: "100",
        });
        expect(result, `${module}.${event} should produce non-empty string`).toBeTruthy();
      }
    }
  });

  it("all admin templates produce non-empty strings", () => {
    for (const [module, events] of Object.entries(adminTemplates)) {
      for (const [event, fn] of Object.entries(events)) {
        const result = fn({
          resourceName: "Test",
          date: "2026-01-01",
          startTime: "10:00",
          endTime: "11:00",
          userName: "User",
          orderNumber: "T123",
          totalAmount: "100",
          itemCount: 1,
          tenantName: "Company",
          officeNumber: "A-1",
          monthlyRate: "50000",
          daysLeft: 10,
          endDate: "2026-02-01",
          startDate: "2026-01-01",
        });
        expect(result, `${module}.${event} admin should produce non-empty string`).toBeTruthy();
      }
    }
  });
});
