// @vitest-environment jsdom
//
// issue #740 (US-5): недельная матрица «ресурс × день». AC-2 (7 дней × ресурсы),
// AC-3 (клик по чипу → колбэк с той же бронью), AC-4 (навигация по неделям),
// AC-6 (клик по свободной ячейке → колбэк для перехода в день), «Итого/день».
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WeekScheduleGrid } from "../week-schedule-grid";

function jsonResponse(body: unknown) {
  return { json: async () => body } as Response;
}

const RESOURCES = [
  { id: "r-1", name: "Беседка №1", description: null, capacity: 12, pricePerHour: 1500, isActive: true },
  { id: "r-2", name: "Беседка №2", description: null, capacity: null, pricePerHour: null, isActive: true },
];

const BOOKING = {
  id: "b-1",
  resourceId: "r-1",
  date: "2030-06-17",
  startTime: "2030-06-17T07:00:00.000Z", // 10:00 МСК
  endTime: "2030-06-17T11:00:00.000Z", // 14:00 МСК
  status: "CONFIRMED" as const,
  clientName: "Иван",
  clientPhone: "+79991234567",
  metadata: { guestCount: 6 },
  cashAmount: null,
  cardAmount: null,
};

const WEEK = {
  weekStart: "2030-06-17",
  days: ["2030-06-17", "2030-06-18", "2030-06-19", "2030-06-20", "2030-06-21", "2030-06-22", "2030-06-23"],
  resources: RESOURCES,
  bookings: [BOOKING],
  hours: Array.from({ length: 15 }, (_, i) => `${(8 + i).toString().padStart(2, "0")}:00`),
  minBookingHours: 2,
};

function renderGrid(over: Partial<React.ComponentProps<typeof WeekScheduleGrid>> = {}) {
  const onBookingClick = vi.fn();
  const onEmptyCellClick = vi.fn();
  render(
    <WeekScheduleGrid
      moduleSlug="gazebos"
      resourceLabel="Беседка"
      unitLabel="чел."
      countMetaKey="guestCount"
      initialDate="2030-06-19"
      onBookingClick={onBookingClick}
      onEmptyCellClick={onEmptyCellClick}
      {...over}
    />
  );
  return { onBookingClick, onEmptyCellClick };
}

describe("WeekScheduleGrid (issue #740)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, data: WEEK }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("грузит неделю одним запросом, нормализовав дату к понедельнику (среда 19.06 → 17.06)", async () => {
    renderGrid();

    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith("/api/gazebos/week-timeline?weekStart=2030-06-17");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("рендерит 7 колонок дней и чипы броней по ресурсам (AC-2)", async () => {
    renderGrid();

    expect(await screen.findByText("Пн 17.06")).toBeTruthy();
    expect(screen.getByText("Вс 23.06")).toBeTruthy();
    expect(screen.getAllByText("Беседка №1")).toHaveLength(1);
    expect(screen.getByText("Иван")).toBeTruthy();
    expect(screen.getByText("10:00–14:00")).toBeTruthy();
    expect(screen.getByText("6 чел.")).toBeTruthy();
  });

  it("клик по чипу отдаёт ту же бронь и её ресурс (AC-3), не срабатывая как клик по ячейке", async () => {
    const { onBookingClick, onEmptyCellClick } = renderGrid();

    fireEvent.click(await screen.findByText("Иван"));

    expect(onBookingClick).toHaveBeenCalledWith(BOOKING, RESOURCES[0]);
    expect(onEmptyCellClick).not.toHaveBeenCalled();
  });

  it("клик по свободной ячейке отдаёт день и ресурс (AC-6)", async () => {
    const { onEmptyCellClick } = renderGrid();
    await screen.findByText("Иван");

    fireEvent.click(screen.getByTestId("cell-r-2-2030-06-18"));

    expect(onEmptyCellClick).toHaveBeenCalledWith("2030-06-18", "r-2");
  });

  it("навигация по неделям: следующая неделя → запрос с weekStart+7 (AC-4)", async () => {
    renderGrid();
    await screen.findByText("Иван");

    fireEvent.click(screen.getByLabelText("Следующая неделя"));

    await vi.waitFor(() =>
      expect(fetch).toHaveBeenLastCalledWith("/api/gazebos/week-timeline?weekStart=2030-06-24")
    );
    fireEvent.click(screen.getByLabelText("Предыдущая неделя"));
    await vi.waitFor(() =>
      expect(fetch).toHaveBeenLastCalledWith("/api/gazebos/week-timeline?weekStart=2030-06-17")
    );
  });

  it("«Итого/день»: занятые часы против ёмкости ресурсы × рабочий день, без отдельного API", async () => {
    renderGrid();
    await screen.findByText("Иван");

    // 2 ресурса × 15 часов = 30; одна бронь на 4 часа в понедельник.
    expect(screen.getByTestId("total-2030-06-17").textContent).toBe("4 из 30 ч");
    expect(screen.getByTestId("total-2030-06-18").textContent).toBe("0 из 30 ч");
  });

  it("бронь на деактивированном ресурсе (нет в resources) не роняет матрицу и не считается в итог (ADR §9 п.4)", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        success: true,
        data: { ...WEEK, bookings: [BOOKING, { ...BOOKING, id: "b-ghost", resourceId: "r-gone" }] },
      })
    );
    renderGrid();

    await screen.findByText("Иван");
    expect(screen.getByTestId("total-2030-06-17").textContent).toBe("4 из 30 ч");
  });

  it("выделенная бронь подсвечивается", async () => {
    renderGrid({ selectedBookingId: "b-1" });
    const chip = (await screen.findByText("Иван")).closest("button");
    expect(chip?.className).toContain("border-blue-500");
  });

  it("ошибка загрузки — кнопка «повторить» делает новый запрос", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ success: false, error: { message: "Нет доступа" } }));
    renderGrid();

    const retry = await screen.findByText("Нет доступа — повторить");
    fireEvent.click(retry);

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Иван")).toBeTruthy();
  });

  it("смена refreshKey перезагружает ту же неделю (после правки брони в карточке)", async () => {
    const { rerender } = render(
      <WeekScheduleGrid
        moduleSlug="ps-park"
        resourceLabel="Стол"
        unitLabel="игр."
        countMetaKey="playerCount"
        initialDate="2030-06-17"
        refreshKey={0}
        onBookingClick={vi.fn()}
        onEmptyCellClick={vi.fn()}
      />
    );
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith("/api/ps-park/week-timeline?weekStart=2030-06-17");

    rerender(
      <WeekScheduleGrid
        moduleSlug="ps-park"
        resourceLabel="Стол"
        unitLabel="игр."
        countMetaKey="playerCount"
        initialDate="2030-06-17"
        refreshKey={1}
        onBookingClick={vi.fn()}
        onEmptyCellClick={vi.fn()}
      />
    );
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });
});

describe("WeekScheduleGrid: блоки «Уборка» (issue #1091)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  function stubWeek(extra: Record<string, unknown>) {
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, data: { ...WEEK, ...extra } }));
  }

  it("рисует «Уборка · 1 ч» после брони и легенду, клик открывает бронь", async () => {
    stubWeek({ cleaningBufferMinutes: 60 });
    const { onBookingClick, onEmptyCellClick } = renderGrid();

    const chip = await screen.findByTestId("week-cleaning-b-1");
    expect(chip.textContent).toContain("Уборка · 1 ч");
    expect(screen.getByTestId("week-legend").textContent).toContain("Уборка");

    fireEvent.click(chip);
    expect(onBookingClick).toHaveBeenCalledWith(expect.objectContaining({ id: "b-1" }), RESOURCES[0]);
    expect(onEmptyCellClick).not.toHaveBeenCalled();
  });

  it("обрезает уборку началом следующей брони того же ресурса", async () => {
    const next = { ...BOOKING, id: "b-2", startTime: "2030-06-17T11:30:00.000Z", endTime: "2030-06-17T13:00:00.000Z" };
    stubWeek({ cleaningBufferMinutes: 60, bookings: [BOOKING, next] });
    renderGrid();

    const chip = await screen.findByTestId("week-cleaning-b-1");
    expect(chip.textContent).toContain("Уборка · 30 мин");
  });

  it("без буфера (PS Park, 0 или поле отсутствует) нет ни блоков, ни легенды", async () => {
    stubWeek({ cleaningBufferMinutes: 0 });
    renderGrid();
    await screen.findAllByText("Иван");
    expect(screen.queryByTestId("week-cleaning-b-1")).toBeNull();
    expect(screen.queryByTestId("week-legend")).toBeNull();
  });
});
