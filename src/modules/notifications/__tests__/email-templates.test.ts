import { describe, it, expect } from "vitest";
import {
  bookingCreatedHtml,
  bookingCreatedText,
  bookingConfirmationHtml,
  bookingConfirmationText,
  bookingCancellationHtml,
  bookingCancellationText,
  bookingReminderHtml,
  bookingReminderText,
  orderConfirmationHtml,
  orderConfirmationText,
  orderStatusHtml,
  orderStatusText,
  magicLinkHtml,
  magicLinkText,
  renderEmailTemplate,
} from "../email-templates";

const BOOKING_DATA = {
  moduleSlug: "gazebos",
  resourceName: "Беседка №1",
  date: "20 апреля 2026",
  startTime: "14:00",
  endTime: "18:00",
};

const ORDER_DATA = {
  moduleSlug: "cafe",
  orderNumber: "42",
  totalAmount: "1250",
  deliveryTo: "301",
  items: [
    { name: "Пицца Маргарита", quantity: 1, price: 800 },
    { name: "Кофе Американо", quantity: 2, price: 225 },
  ],
};

describe("email-templates", () => {
  // ── Layout checks ───────────────────────────────────────────────────────────

  describe("emailLayout", () => {
    it("booking confirmation HTML contains DOCTYPE and body", () => {
      const html = bookingConfirmationHtml(BOOKING_DATA);
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<body");
      expect(html).toContain("Деловой Парк");
    });

    it("all templates include footer with phone number", () => {
      const html = bookingCreatedHtml(BOOKING_DATA);
      expect(html).toContain("+7 (499) 677-48-88");
    });
  });

  // ── booking.created ─────────────────────────────────────────────────────────

  describe("bookingCreatedHtml", () => {
    it("contains resource name and date/time", () => {
      const html = bookingCreatedHtml(BOOKING_DATA);
      expect(html).toContain("Беседка №1");
      expect(html).toContain("20 апреля 2026");
      expect(html).toContain("14:00");
      expect(html).toContain("18:00");
    });

    it("says заявка принята", () => {
      const html = bookingCreatedHtml(BOOKING_DATA);
      expect(html).toContain("Заявка принята");
    });
  });

  describe("bookingCreatedText", () => {
    it("returns plain text with key info", () => {
      const text = bookingCreatedText(BOOKING_DATA);
      expect(text).toContain("Заявка принята");
      expect(text).toContain("Беседка №1");
      expect(text).toContain("14:00");
    });
  });

  // ── booking.confirmed ───────────────────────────────────────────────────────

  describe("bookingConfirmationHtml", () => {
    it("contains confirmation message and resource info", () => {
      const html = bookingConfirmationHtml(BOOKING_DATA);
      expect(html).toContain("подтверждено");
      expect(html).toContain("Беседка №1");
      expect(html).toContain("20 апреля 2026");
    });

    it("uses green accent for gazebos", () => {
      const html = bookingConfirmationHtml(BOOKING_DATA);
      expect(html).toContain("#16A34A");
    });

    it("uses violet accent for ps-park", () => {
      const html = bookingConfirmationHtml({ ...BOOKING_DATA, moduleSlug: "ps-park" });
      expect(html).toContain("#7C3AED");
    });
  });

  describe("bookingConfirmationText", () => {
    it("returns plain text with booking details", () => {
      const text = bookingConfirmationText(BOOKING_DATA);
      expect(text).toContain("подтверждено");
      expect(text).toContain("14:00 — 18:00");
    });
  });

  // ── booking.cancelled ───────────────────────────────────────────────────────

  describe("bookingCancellationHtml", () => {
    it("contains cancellation message", () => {
      const html = bookingCancellationHtml(BOOKING_DATA);
      expect(html).toContain("отменено");
      expect(html).toContain("Беседка №1");
    });

    it("shows cancel reason when provided", () => {
      const html = bookingCancellationHtml({ ...BOOKING_DATA, cancelReason: "Погода" });
      expect(html).toContain("Погода");
    });

    it("does not show reason row when not provided", () => {
      const html = bookingCancellationHtml(BOOKING_DATA);
      // Should not have empty reason row
      expect(html).not.toContain("Причина</td>\n          <td");
    });
  });

  describe("bookingCancellationText", () => {
    it("includes cancel reason when provided", () => {
      const text = bookingCancellationText({ ...BOOKING_DATA, cancelReason: "Погода" });
      expect(text).toContain("Погода");
    });
  });

  // ── booking.reminder ────────────────────────────────────────────────────────

  describe("bookingReminderHtml", () => {
    it("mentions 1 hour reminder", () => {
      const html = bookingReminderHtml(BOOKING_DATA);
      expect(html).toContain("1 час");
      expect(html).toContain("Беседка №1");
      expect(html).toContain("14:00");
    });
  });

  describe("bookingReminderText", () => {
    it("returns reminder text with resource and time", () => {
      const text = bookingReminderText(BOOKING_DATA);
      expect(text).toContain("1 час");
      expect(text).toContain("14:00");
    });
  });

  // ── order.placed ────────────────────────────────────────────────────────────

  describe("orderConfirmationHtml", () => {
    it("contains order number and total", () => {
      const html = orderConfirmationHtml(ORDER_DATA);
      expect(html).toContain("#42");
      expect(html).toContain("1250");
    });

    it("lists order items", () => {
      const html = orderConfirmationHtml(ORDER_DATA);
      expect(html).toContain("Пицца Маргарита");
      expect(html).toContain("Кофе Американо");
    });

    it("shows delivery office when provided", () => {
      const html = orderConfirmationHtml(ORDER_DATA);
      expect(html).toContain("301");
    });

    it("uses amber accent for cafe", () => {
      const html = orderConfirmationHtml(ORDER_DATA);
      expect(html).toContain("#F59E0B");
    });
  });

  describe("orderConfirmationText", () => {
    it("includes order number and delivery info", () => {
      const text = orderConfirmationText(ORDER_DATA);
      expect(text).toContain("#42");
      expect(text).toContain("1250");
      expect(text).toContain("301");
    });
  });

  // ── order status ────────────────────────────────────────────────────────────

  describe("orderStatusHtml", () => {
    it("shows READY status correctly", () => {
      const html = orderStatusHtml({ ...ORDER_DATA, status: "READY" });
      expect(html).toContain("готов");
    });

    it("shows PREPARING status correctly", () => {
      const html = orderStatusHtml({ ...ORDER_DATA, status: "PREPARING" });
      expect(html).toContain("готовится");
    });

    it("shows CANCELLED with red accent", () => {
      const html = orderStatusHtml({ ...ORDER_DATA, status: "CANCELLED" });
      expect(html).toContain("отменён");
      expect(html).toContain("#ef4444");
    });
  });

  describe("orderStatusText", () => {
    it("returns status text for DELIVERED", () => {
      const text = orderStatusText({ ...ORDER_DATA, status: "DELIVERED" });
      expect(text).toContain("доставлен");
    });
  });

  // ── magic link ──────────────────────────────────────────────────────────────

  describe("magicLinkHtml", () => {
    const MAGIC_DATA = {
      url: "https://delovoy-park.ru/api/auth/verify-email?token=abc123",
      expires: "15 минут",
    };

    it("contains the login URL", () => {
      const html = magicLinkHtml(MAGIC_DATA);
      expect(html).toContain("abc123");
    });

    it("mentions expiry time", () => {
      const html = magicLinkHtml(MAGIC_DATA);
      expect(html).toContain("15 минут");
    });

    it("includes login button", () => {
      const html = magicLinkHtml(MAGIC_DATA);
      expect(html).toContain("Войти в аккаунт");
    });

    it("uses blue accent", () => {
      const html = magicLinkHtml(MAGIC_DATA);
      expect(html).toContain("#0071e3");
    });
  });

  describe("magicLinkText", () => {
    it("contains URL and expiry", () => {
      const text = magicLinkText({ url: "https://example.com/token", expires: "15 минут" });
      expect(text).toContain("https://example.com/token");
      expect(text).toContain("15 минут");
    });
  });

  // ── renderEmailTemplate dispatcher ─────────────────────────────────────────

  describe("renderEmailTemplate", () => {
    it("returns template for booking.created", () => {
      const result = renderEmailTemplate("gazebos", "booking.created", BOOKING_DATA);
      expect(result).not.toBeNull();
      expect(result!.subject).toContain("Заявка");
      expect(result!.html).toContain("<!DOCTYPE html>");
      expect(result!.text).toBeTruthy();
    });

    it("returns template for booking.confirmed", () => {
      const result = renderEmailTemplate("gazebos", "booking.confirmed", BOOKING_DATA);
      expect(result).not.toBeNull();
      expect(result!.subject).toContain("подтверждено");
    });

    it("returns template for booking.cancelled", () => {
      const result = renderEmailTemplate("gazebos", "booking.cancelled", BOOKING_DATA);
      expect(result).not.toBeNull();
      expect(result!.subject).toContain("отменено");
    });

    it("returns template for booking.reminder", () => {
      const result = renderEmailTemplate("gazebos", "booking.reminder", BOOKING_DATA);
      expect(result).not.toBeNull();
      expect(result!.subject).toContain("Напоминание");
    });

    it("returns template for order.placed", () => {
      const result = renderEmailTemplate("cafe", "order.placed", ORDER_DATA);
      expect(result).not.toBeNull();
      expect(result!.subject).toContain("#42");
    });

    it("returns template for order.ready", () => {
      const result = renderEmailTemplate("cafe", "order.ready", { ...ORDER_DATA, status: "READY" });
      expect(result).not.toBeNull();
    });

    it("returns null for unknown event", () => {
      const result = renderEmailTemplate("gazebos", "unknown.event", {});
      expect(result).toBeNull();
    });

    it("injects moduleSlug into data for accent color resolution", () => {
      const result = renderEmailTemplate("ps-park", "booking.confirmed", {
        ...BOOKING_DATA,
        moduleSlug: undefined,
      });
      expect(result).not.toBeNull();
      // ps-park accent should be used
      expect(result!.html).toContain("#7C3AED");
    });
  });
});
