// @vitest-environment jsdom
//
// issue #668: печатный лист дня. AC-1 (открытие), AC-2 (без UI-элементов при
// печати — проверяем через className print:hidden, т.к. jsdom не рендерит
// @media print), AC-4 (чекбокс "показывать отменённые" переключает запрос).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PrintDaySheet } from "../print-day-sheet";

function jsonResponse(body: unknown) {
  return { json: async () => body } as Response;
}

const ROW = {
  bookingId: "b-1",
  startTime: "2030-06-15T10:00:00.000Z",
  endTime: "2030-06-15T11:00:00.000Z",
  resourceName: "Беседка №1",
  clientName: "Иван",
  clientPhone: "+79991234567",
  status: "CONFIRMED",
  guestCount: 6,
  comment: "Без орехов",
};

function renderSheet(onClose = vi.fn()) {
  return render(
    <PrintDaySheet
      moduleSlug="gazebos"
      title="Барбекю Парк"
      resourceLabel="Беседка"
      date="2030-06-15"
      onClose={onClose}
    />
  );
}

describe("PrintDaySheet (issue #668)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("print", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("при монтировании запрашивает данные с includeCancelled=false (AC-4, по умолчанию)", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, data: [] }));
    renderSheet();

    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());

    expect(fetch).toHaveBeenCalledWith(
      "/api/gazebos/print-schedule?date=2030-06-15&includeCancelled=false"
    );
  });

  it("рендерит строки таблицы, полученные от сервера (AC-2)", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, data: [ROW] }));
    renderSheet();

    expect(await screen.findByText("Иван")).toBeTruthy();
    expect(screen.getByText("+79991234567")).toBeTruthy();
    expect(screen.getByText("Беседка №1")).toBeTruthy();
    expect(screen.getByText("Без орехов")).toBeTruthy();
    expect(screen.getByText("6")).toBeTruthy();
  });

  it("отметка чекбокса перезапрашивает данные с includeCancelled=true (AC-4)", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, data: [] }));
    renderSheet();

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByLabelText("Показывать отменённые"));

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/gazebos/print-schedule?date=2030-06-15&includeCancelled=true"
    );
  });

  it("кнопка «Печать» вызывает window.print()", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, data: [ROW] }));
    renderSheet();

    await screen.findByText("Иван");
    fireEvent.click(screen.getByRole("button", { name: "Печать" }));

    expect(window.print).toHaveBeenCalledTimes(1);
  });

  it("кнопка ✕ вызывает onClose", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, data: [] }));
    const onClose = vi.fn();
    renderSheet(onClose);

    fireEvent.click(screen.getByText("✕"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("показывает сообщение об отсутствии броней, когда список пуст", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, data: [] }));
    renderSheet();

    expect(await screen.findByText("На этот день броней нет.")).toBeTruthy();
  });

  it("интерактивные элементы помечены print:hidden — не печатаются (AC-2)", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, data: [] }));
    renderSheet();

    const printButton = await screen.findByRole("button", { name: "Печать" });
    expect(printButton.closest(".print\\:hidden")).not.toBeNull();
  });
});
