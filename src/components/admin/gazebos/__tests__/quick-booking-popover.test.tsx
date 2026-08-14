// @vitest-environment jsdom
//
// #523: minBookingHours was hardcoded to 4 in this component instead of
// coming from Module.config (via TimelineData → TimelineGrid → this popover).
// These tests pin that the popover actually uses the prop, not a constant.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { GazeboQuickBookingPopover } from "../quick-booking-popover";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(() => {
  cleanup();
});

function renderPopover(minBookingHours: number) {
  const { container } = render(
    <GazeboQuickBookingPopover
      resourceId="resource-1"
      resourceName="Беседка №1"
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

describe("GazeboQuickBookingPopover minBookingHours", () => {
  it("defaults the end time to start + minBookingHours (2h), not a hardcoded 4h", () => {
    const { endInput } = renderPopover(2);
    expect(endInput.value).toBe("12:00");
  });

  it("defaults the end time to start + minBookingHours (1h) when configured to 1", () => {
    const { endInput } = renderPopover(1);
    expect(endInput.value).toBe("11:00");
  });

  it("sets the end input's min attribute to start + minBookingHours (6h)", () => {
    const { endInput } = renderPopover(6);
    expect(endInput.min).toBe("16:00");
  });
});
