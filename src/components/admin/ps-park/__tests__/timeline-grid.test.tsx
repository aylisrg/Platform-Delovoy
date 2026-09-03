// @vitest-environment jsdom
//
// issue #740 (US-5): переключатель «День / Неделя» в Плей Парке — поведение
// идентично беседкам (AC-5). Drag-and-drop здесь намеренно нет (US-6 AC-7).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../booking-detail-card", () => ({
  BookingDetailCard: ({ booking, resourceName }: { booking: { id: string }; resourceName: string }) => (
    <div data-testid="detail-card">
      CARD:{booking.id}:{resourceName}
    </div>
  ),
}));
vi.mock("../quick-booking-popover", () => ({ QuickBookingPopover: () => <div>POPOVER</div> }));
vi.mock("@/components/admin/shared/print-day-sheet", () => ({ PrintDaySheet: () => <div>PRINT</div> }));

const weekProps: { current: Record<string, unknown> | null } = { current: null };
vi.mock("@/components/admin/shared/week-schedule-grid", () => ({
  WeekScheduleGrid: (props: Record<string, unknown>) => {
    weekProps.current = props;
    return <div data-testid="week-grid">WEEK:{String(props.moduleSlug)}</div>;
  },
}));

import { TimelineGrid } from "../timeline-grid";

function jsonResponse(body: unknown) {
  return { json: async () => body } as Response;
}

const DATA = {
  date: "2030-06-17",
  resources: [{ id: "t-1", name: "Стол 1", description: null, capacity: 4, pricePerHour: 300, isActive: true, metadata: null }],
  bookings: [
    {
      id: "b-1",
      resourceId: "t-1",
      startTime: "2030-06-17T07:00:00.000Z",
      endTime: "2030-06-17T09:00:00.000Z",
      status: "CONFIRMED" as const,
      clientName: "Пётр",
      clientPhone: null,
      metadata: { playerCount: 2 },
      cashAmount: null,
      cardAmount: null,
    },
  ],
  hours: Array.from({ length: 15 }, (_, i) => `${(8 + i).toString().padStart(2, "0")}:00`),
  minBookingHours: 1,
};

describe("TimelineGrid (ps-park) — недельный вид (issue #740, AC-5)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, data: DATA }));
    weekProps.current = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("переключатель показывает недельную матрицу Плей Парка с подписями стола и прячет дневную сетку", () => {
    render(<TimelineGrid initialData={DATA} initialDate="2030-06-17" />);
    expect(screen.getByText("Пётр")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Неделя" }));

    expect(screen.getByTestId("week-grid").textContent).toBe("WEEK:ps-park");
    expect(weekProps.current).toMatchObject({ resourceLabel: "Стол", unitLabel: "игр.", countMetaKey: "playerCount" });
    expect(screen.queryByText("Пётр")).toBeNull();
  });

  it("бронь из недели открывает ту же карточку; свободная ячейка возвращает в день с загрузкой даты", async () => {
    render(<TimelineGrid initialData={DATA} initialDate="2030-06-17" />);
    fireEvent.click(screen.getByRole("button", { name: "Неделя" }));

    const onBookingClick = weekProps.current?.onBookingClick as (b: unknown, r: unknown) => void;
    act(() => onBookingClick({ ...DATA.bookings[0], date: "2030-06-18" }, { id: "t-1", name: "Стол 1", pricePerHour: 300 }));
    expect(screen.getByTestId("detail-card").textContent).toBe("CARD:b-1:Стол 1");

    const onEmptyCellClick = weekProps.current?.onEmptyCellClick as (d: string, r: string) => void;
    act(() => onEmptyCellClick("2030-06-20", "t-1"));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/ps-park/timeline?date=2030-06-20"));
    expect(screen.queryByTestId("week-grid")).toBeNull();
    // карточка, открытая из недели, закрыта — не «переезжает» в день с чужой датой (находка QA)
    expect(screen.queryByTestId("detail-card")).toBeNull();
  });
});
