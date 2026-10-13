// @vitest-environment jsdom
//
// issue #1091: мобильный таймлайн админки беседок показывает блок «Уборка»
// после брони (как дневной вид #1085).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GazeboMobileTimeline } from "../mobile-timeline";
import type { TimelineData } from "@/modules/gazebos/types";

const DATE = "2030-06-17";

function makeData(over: Partial<TimelineData> = {}): TimelineData {
  return {
    date: DATE,
    resources: [
      { id: "r-1", name: "Беседка №1", description: null, capacity: 10, pricePerHour: null, isActive: true, metadata: null },
    ],
    bookings: [
      {
        id: "b-1",
        resourceId: "r-1",
        startTime: `${DATE}T07:00:00.000Z`, // 10:00 МСК
        endTime: `${DATE}T09:00:00.000Z`, // 12:00 МСК
        status: "CONFIRMED",
        clientName: "Иван",
        clientPhone: null,
        metadata: null,
        cashAmount: null,
        cardAmount: null,
      },
    ],
    hours: Array.from({ length: 15 }, (_, i) => `${(8 + i).toString().padStart(2, "0")}:00`),
    minBookingHours: 1,
    ...over,
  } as unknown as TimelineData;
}

describe("GazeboMobileTimeline: уборка (issue #1091)", () => {
  afterEach(() => cleanup());

  it("показывает «Уборка · 1 ч» 12:00–13:00 после брони", () => {
    render(<GazeboMobileTimeline initialData={makeData({ cleaningBufferMinutes: 60 })} initialDate={DATE} />);
    const block = screen.getByTestId("mobile-cleaning-b-1");
    expect(block.textContent).toContain("12:00–13:00");
    expect(block.textContent).toContain("Уборка · 1 ч");
    // слоты 12:00 и 12:30 заняты уборкой, а 13:00 свободен
    expect(screen.queryByText("12:30")).toBeNull();
    expect(screen.getByText("13:00")).toBeTruthy();
  });

  it("клик по уборке открывает карточку брони", () => {
    render(<GazeboMobileTimeline initialData={makeData({ cleaningBufferMinutes: 60 })} initialDate={DATE} />);
    fireEvent.click(screen.getByTestId("mobile-cleaning-b-1"));
    expect(screen.getAllByText(/Иван/).length).toBeGreaterThan(1);
  });

  it("без буфера блока нет", () => {
    render(<GazeboMobileTimeline initialData={makeData({ cleaningBufferMinutes: 0 })} initialDate={DATE} />);
    expect(screen.queryByTestId("mobile-cleaning-b-1")).toBeNull();
  });
});
