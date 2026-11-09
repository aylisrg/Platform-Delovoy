import { describe, expect, it } from "vitest";
import { htmlToStaffPayload } from "../staff-payload";
import { renderAdminMessage } from "../templates";

describe("htmlToStaffPayload", () => {
  it("turns the admin HTML into a plain title, body and a link button", () => {
    const html = `🆕 <b>Новая бронь — нужно подтвердить</b>\n\nБеседка №1\n📅 сб · 10:00–14:00\n👤 Иван &lt;VIP&gt; &amp; Ко\n\nПодтвердите.\n\n<a href="https://delovoy-park.ru/admin/gazebos/bookings/b1">Открыть бронь в панели</a>`;
    const payload = htmlToStaffPayload(html, "Уведомление");
    expect(payload.title).toBe("🆕 Новая бронь — нужно подтвердить");
    expect(payload.body).toBe("Беседка №1\n📅 сб · 10:00–14:00\n👤 Иван <VIP> & Ко\n\nПодтвердите.");
    expect(payload.actions).toEqual([{ label: "Открыть бронь в панели", url: "https://delovoy-park.ru/admin/gazebos/bookings/b1" }]);
    // Channels escape title/body themselves — no markup may survive.
    expect(`${payload.title}${payload.body}`).not.toMatch(/<\/?(b|a)\b/);
  });

  it("drops non-http links instead of making a broken button", () => {
    const payload = htmlToStaffPayload(`<b>T</b>\n\n<a href="javascript:alert(1)">x</a>`, "F");
    expect(payload.actions).toBeUndefined();
    expect(payload.title).toBe("T");
  });

  it("falls back to the given title for an empty message", () => {
    expect(htmlToStaffPayload("", "Уведомление")).toEqual({ title: "Уведомление", body: "" });
  });

  it("works on every real booking admin template", () => {
    const data = { resourceName: "Беседка №2", date: "2026-11-10", startTime: "12:00", endTime: "15:00", clientName: "Анна", bookingId: "bk1" };
    for (const type of ["booking.created", "booking.admin_created", "booking.rescheduled", "booking.cancelled", "booking.ending_soon"]) {
      const html = renderAdminMessage("gazebos", type, data);
      expect(html, type).toBeTruthy();
      const payload = htmlToStaffPayload(html!, "x");
      expect(payload.title, type).not.toMatch(/[<>]/);
      expect(payload.body, type).toContain("Беседка №2");
    }
  });
});
