// @vitest-environment jsdom
//
// issue #740 (US-5): переключатель «День / Неделя», карточка из недельного вида,
// клик по свободной ячейке → дневной вид. issue #741 (US-6): drag-and-drop —
// drop шлёт тот же PATCH, что форма редактирования; 409 → откат и текст ошибки;
// нулевой сдвиг → без запроса; растяжение меняет только endTime; клик без
// движения открывает карточку. dnd-kit замокан: события drag вызываются напрямую
// через захваченные пропсы DndContext.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

type DragHandlers = {
  onDragStart?: (e: unknown) => void;
  onDragEnd?: (e: unknown) => void;
};
const captured: DragHandlers = {};

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children, onDragStart, onDragEnd }: DragHandlers & { children: ReactNode }) => {
    captured.onDragStart = onDragStart;
    captured.onDragEnd = onDragEnd;
    return <>{children}</>;
  },
  DragOverlay: ({ children }: { children: ReactNode }) => <>{children}</>,
  PointerSensor: class {},
  useSensor: () => ({}),
  useSensors: () => [],
  useDraggable: () => ({ setNodeRef: () => undefined, listeners: {}, attributes: {}, transform: null, isDragging: false }),
  useDroppable: () => ({ setNodeRef: () => undefined, isOver: false }),
}));

vi.mock("../booking-detail-card", () => ({
  GazeboBookingDetailCard: ({ booking, resourceName }: { booking: { id: string }; resourceName: string }) => (
    <div data-testid="detail-card">
      CARD:{booking.id}:{resourceName}
    </div>
  ),
}));
vi.mock("../quick-booking-popover", () => ({ GazeboQuickBookingPopover: () => <div>POPOVER</div> }));
vi.mock("@/components/admin/shared/print-day-sheet", () => ({ PrintDaySheet: () => <div>PRINT</div> }));

const weekProps: { current: Record<string, unknown> | null } = { current: null };
vi.mock("@/components/admin/shared/week-schedule-grid", () => ({
  WeekScheduleGrid: (props: Record<string, unknown>) => {
    weekProps.current = props;
    return <div data-testid="week-grid">WEEK:{String(props.moduleSlug)}</div>;
  },
}));

import { GazeboTimelineGrid } from "../timeline-grid";

function jsonResponse(body: unknown) {
  return { json: async () => body } as Response;
}

const RESOURCES = [
  { id: "r-1", name: "Беседка №1", description: null, capacity: 12, pricePerHour: null, isActive: true, metadata: null },
  { id: "r-2", name: "Беседка №2", description: null, capacity: 8, pricePerHour: null, isActive: true, metadata: null },
];

const BOOKING = {
  id: "b-1",
  resourceId: "r-1",
  startTime: "2030-06-17T07:00:00.000Z", // 10:00 МСК
  endTime: "2030-06-17T11:00:00.000Z", // 14:00 МСК
  status: "CONFIRMED" as const,
  clientName: "Иван",
  clientPhone: "+79991234567",
  metadata: { guestCount: 6 },
  cashAmount: null,
  cardAmount: null,
};

const DATA = {
  date: "2030-06-17",
  resources: RESOURCES,
  bookings: [BOOKING],
  hours: Array.from({ length: 15 }, (_, i) => `${(8 + i).toString().padStart(2, "0")}:00`), // 08:00–23:00
  minBookingHours: 2,
};

function renderGrid() {
  return render(<GazeboTimelineGrid initialData={DATA} initialDate="2030-06-17" />);
}

/** Дорожка одного дня — 900 px: 60 px/час при 15 часах. */
function stubTrackWidth(width = 900) {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    width,
    height: 64,
    top: 0,
    left: 0,
    right: width,
    bottom: 64,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

function drag(activeId: string, overId: string | null, dx: number) {
  act(() => {
    captured.onDragStart?.({ active: { id: activeId } });
  });
  act(() => {
    captured.onDragEnd?.({ active: { id: activeId }, over: overId ? { id: overId } : null, delta: { x: dx, y: 0 } });
  });
}

describe("GazeboTimelineGrid — недельный вид (issue #740)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, data: DATA }));
    weekProps.current = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    cleanup();
  });

  it("по умолчанию дневной вид с навигатором; переключатель «Неделя» показывает матрицу и прячет день (AC-1)", () => {
    renderGrid();
    expect(screen.getByText("Сегодня")).toBeTruthy();
    expect(screen.queryByTestId("week-grid")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Неделя" }));

    expect(screen.getByTestId("week-grid").textContent).toBe("WEEK:gazebos");
    expect(screen.queryByText("Сегодня")).toBeNull();
    expect(screen.queryByTestId("booking-b-1")).toBeNull();
    expect(screen.getByRole("button", { name: "Неделя" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "День" }));
    expect(screen.queryByTestId("week-grid")).toBeNull();
    expect(screen.getByTestId("booking-b-1")).toBeTruthy();
  });

  it("клик по брони в недельном виде открывает ту же карточку с именем ресурса из недели (AC-3)", () => {
    renderGrid();
    fireEvent.click(screen.getByRole("button", { name: "Неделя" }));
    const onBookingClick = weekProps.current?.onBookingClick as (b: unknown, r: unknown) => void;

    act(() => onBookingClick({ ...BOOKING, date: "2030-06-19" }, { id: "r-9", name: "Беседка у пруда", pricePerHour: 900 }));

    expect(screen.getByTestId("detail-card").textContent).toBe("CARD:b-1:Беседка у пруда");
  });

  it("клик по свободной ячейке закрывает карточку, открытую из недели (находка QA)", async () => {
    renderGrid();
    fireEvent.click(screen.getByRole("button", { name: "Неделя" }));
    const onBookingClick = weekProps.current?.onBookingClick as (b: unknown, r: unknown) => void;
    const onEmptyCellClick = weekProps.current?.onEmptyCellClick as (d: string, r: string) => void;
    act(() => onBookingClick({ ...BOOKING, date: "2030-06-19" }, { id: "r-1", name: "Беседка №1", pricePerHour: null }));
    expect(screen.getByTestId("detail-card")).toBeTruthy();

    act(() => onEmptyCellClick("2030-06-20", "r-2"));

    expect(screen.queryByTestId("detail-card")).toBeNull();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/gazebos/timeline?date=2030-06-20"));
  });

  it("клик по свободной ячейке недели переводит в дневной вид на этот день (AC-6)", async () => {
    renderGrid();
    fireEvent.click(screen.getByRole("button", { name: "Неделя" }));
    const onEmptyCellClick = weekProps.current?.onEmptyCellClick as (d: string, r: string) => void;

    act(() => onEmptyCellClick("2030-06-19", "r-2"));

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/gazebos/timeline?date=2030-06-19"));
    expect(screen.queryByTestId("week-grid")).toBeNull();
    expect(screen.getByText("Сегодня")).toBeTruthy();
  });
});

describe("GazeboTimelineGrid — drag-and-drop (issue #741)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, data: DATA }));
    stubTrackWidth();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    cleanup();
  });

  it("drop на другую дорожку со сдвигом 90 px → PATCH без status с ресурсом-приёмником и временем +1.5 ч (AC-1, AC-4)", async () => {
    renderGrid();

    drag("move:b-1", "res:r-2", 90);

    await vi.waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/gazebos/bookings/b-1", expect.objectContaining({ method: "PATCH" }))
    );
    const [, init] = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/gazebos/bookings/b-1")!;
    expect(JSON.parse(String(init?.body))).toEqual({
      resourceId: "r-2",
      date: "2030-06-17",
      startTime: "11:30",
      endTime: "15:30",
    });
    // после успеха — перечитываем день с сервера
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/gazebos/timeline?date=2030-06-17"));
  });

  it("сдвиг привязывается к получасу: 20 px (0.33 ч) → 0.5 ч", async () => {
    renderGrid();

    drag("move:b-1", "res:r-1", 20);

    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(JSON.parse(String(init?.body))).toMatchObject({ startTime: "10:30", endTime: "14:30", resourceId: "r-1" });
  });

  it("микро-сдвиг (< полшага) на той же дорожке — запроса нет, гостю ничего не уходит (ADR §5.3 п.5)", async () => {
    renderGrid();

    drag("move:b-1", "res:r-1", 5);

    await new Promise((r) => setTimeout(r, 10));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("409 BOOKING_CONFLICT → блок возвращается на место, текст ошибки сервера показан, карточка не открывается (AC-3)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ success: false, error: { code: "BOOKING_CONFLICT", message: "Это время уже занято" } })
    );
    renderGrid();
    const before = screen.getByTestId("booking-b-1").style.left;

    drag("move:b-1", "res:r-2", 120);

    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Это время уже занято");
    expect(screen.getByTestId("booking-b-1").style.left).toBe(before);
    expect(screen.queryByTestId("detail-card")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1); // без перечитывания дня после отказа
  });

  it("растяжение правого края на 60 px меняет только endTime (+1 ч) (AC-2)", async () => {
    renderGrid();

    drag("resize:b-1", null, 60);

    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      resourceId: "r-1",
      date: "2030-06-17",
      startTime: "10:00",
      endTime: "15:00",
    });
  });

  it("клик без движения по брони открывает карточку, а не переносит", () => {
    renderGrid();

    fireEvent.click(screen.getByTestId("booking-b-1"));

    expect(screen.getByTestId("detail-card").textContent).toBe("CARD:b-1:Беседка №1");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("сеть недоступна → откат и понятное сообщение", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network"));
    renderGrid();

    drag("move:b-1", "res:r-2", 120);

    expect((await screen.findByRole("alert")).textContent).toContain("нет связи");
  });
});
