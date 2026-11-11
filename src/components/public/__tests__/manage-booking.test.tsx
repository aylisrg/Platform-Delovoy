// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ManageBooking } from "../manage-booking";
import type { ManagedBookingView } from "@/modules/booking/manage";
vi.mock("@/components/public/dashboard/tracking", () => ({
  trackDashboard: vi.fn(),
}));
afterEach(cleanup);
it("does not describe an on-site payment as an unpaid booking", () => {
  const view: ManagedBookingView = {
    number: "БП-001",
    resourceName: "Беседка",
    date: "2026-12-01",
    startTime: "12:00",
    endTime: "13:00",
    status: "CONFIRMED",
    guestName: null,
    totalPrice: 5000,
    paidAmount: 1000,
    items: [],
    offer: null,
    refund: {
      paidAmount: 0,
      refundAmount: 0,
      deductions: [],
      hoursUntilStart: 48,
    },
    reschedule: { allowed: false, reason: "Перенос через администратора" },
    paymentUrl: null,
    acceptanceRequired: false,
  };
  render(<ManageBooking initial={view} endpoint="/api/profile/bookings/b1" />);
  expect(screen.getByText(/получено.*на месте/)).toBeTruthy();
  expect(screen.queryByText(/Оплата по брони не проходила/)).toBeNull();
});
