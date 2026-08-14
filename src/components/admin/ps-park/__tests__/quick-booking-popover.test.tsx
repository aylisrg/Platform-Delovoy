// @vitest-environment jsdom
//
// #523: this component had no minimum-duration enforcement at all (unlike
// its gazebos counterpart, which hardcoded MIN_BOOKING_HOURS=4) even though
// ps-park settings already validated and saved minBookingHours — it was
// completely inert. These tests pin that the popover now actually uses the
// real settings value passed as a prop.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { QuickBookingPopover } from "../quick-booking-popover";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(() => {
  cleanup();
});

function renderPopover(minBookingHours: number) {
  const { container } = render(
    <QuickBookingPopover
      resourceId="table-1"
      resourceName="Стол №1"
      date="2030-06-15"
      startTime="10:00"
      maxEndTime="23:00"
      pricePerHour={500}
      minBookingHours={minBookingHours}
      onClose={vi.fn()}
      onCreated={vi.fn()}
    />
  );
  const timeInputs = container.querySelectorAll<HTMLInputElement>('input[type="time"]');
  return { startInput: timeInputs[0], endInput: timeInputs[1] };
}

describe("QuickBookingPopover minBookingHours", () => {
  it("defaults the end time to start + minBookingHours (1h, the real ps-park settings default)", () => {
    const { endInput } = renderPopover(1);
    expect(endInput.value).toBe("11:00");
  });

  it("defaults the end time to start + minBookingHours (3h) when configured higher", () => {
    const { endInput } = renderPopover(3);
    expect(endInput.value).toBe("13:00");
  });

  it("sets the end input's min attribute to start + minBookingHours, not just start", () => {
    const { startInput, endInput } = renderPopover(2);
    expect(startInput.value).toBe("10:00");
    expect(endInput.min).toBe("12:00");
  });
});
