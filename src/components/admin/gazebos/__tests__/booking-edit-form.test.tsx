// @vitest-environment jsdom
//
// #439: rescheduleBookingSchema и PATCH-ветка сервера уже принимали
// resourceId/date, но форма их не показывала — операторы были вынуждены
// отменять и создавать бронь заново, чтобы перенести на другой день/беседку.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { GazeboBookingEditForm } from "../booking-edit-form";
import type { TimelineBooking } from "@/modules/gazebos/types";

const booking: TimelineBooking = {
  id: "booking-1",
  resourceId: "resource-1",
  startTime: "2026-09-01T10:00:00.000Z",
  endTime: "2026-09-01T12:00:00.000Z",
  status: "CONFIRMED",
  clientName: "Иван Петров",
  clientPhone: "+79991234567",
  metadata: {},
  cashAmount: null,
  cardAmount: null,
};

const resourcesList = [
  { id: "resource-1", name: "Беседка №1", description: null, capacity: 6, pricePerHour: 1000, isActive: true, metadata: null },
  { id: "resource-2", name: "Беседка №2", description: null, capacity: 10, pricePerHour: 1500, isActive: true, metadata: null },
];

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

function renderForm() {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(
    <GazeboBookingEditForm
      booking={booking}
      resourceName="Беседка №1"
      appliedRate={1000}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
  return { onClose, onSaved };
}

describe("GazeboBookingEditForm — смена даты и беседки (#439)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    refreshMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("подставляет текущую дату и беседку в новые поля формы", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, data: resourcesList }));

    renderForm();

    const dateInput = screen.getByLabelText("Дата") as HTMLInputElement;
    expect(dateInput.value).toBe("2026-09-01");

    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Беседка №1" })).toBeTruthy();
    });
    const select = screen.getByLabelText("Беседка") as HTMLSelectElement;
    expect(select.value).toBe("resource-1");
  });

  it("до загрузки списка беседок селект не пустой — показывает текущую беседку по имени", () => {
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {})); // never resolves

    renderForm();

    const select = screen.getByLabelText("Беседка") as HTMLSelectElement;
    expect(select.value).toBe("resource-1");
    expect(screen.getByRole("option", { name: "Беседка №1" })).toBeTruthy();
  });

  it("отправляет PATCH с новой датой и новой беседкой при сохранении", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/gazebos") {
        return jsonResponse({ success: true, data: resourcesList });
      }
      return jsonResponse({ success: true, data: { ...booking, resourceId: "resource-2" } });
    });

    const { onSaved } = renderForm();
    await waitFor(() => screen.getByRole("option", { name: "Беседка №2" }));

    fireEvent.change(screen.getByLabelText("Дата"), { target: { value: "2026-09-05" } });
    fireEvent.change(screen.getByLabelText("Беседка"), { target: { value: "resource-2" } });
    fireEvent.click(screen.getByText("Сохранить"));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    const patchCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes("/bookings/booking-1"));
    expect(patchCall).toBeTruthy();
    const body = JSON.parse((patchCall![1] as RequestInit).body as string);
    expect(body).toMatchObject({ resourceId: "resource-2", date: "2026-09-05" });
  });

  it("показывает BOOKING_CONFLICT при переносе на занятый слот другой беседки", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/gazebos") {
        return jsonResponse({ success: true, data: resourcesList });
      }
      return jsonResponse(
        { success: false, error: { code: "BOOKING_CONFLICT", message: "Это время уже занято" } },
        false,
        409
      );
    });

    const { onSaved } = renderForm();
    await waitFor(() => screen.getByRole("option", { name: "Беседка №2" }));

    fireEvent.change(screen.getByLabelText("Беседка"), { target: { value: "resource-2" } });
    fireEvent.click(screen.getByText("Сохранить"));

    expect(await screen.findByText("Это время уже занято")).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("отправляет неизменённые resourceId/date, если оператор их не трогал", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/gazebos") {
        return jsonResponse({ success: true, data: resourcesList });
      }
      return jsonResponse({ success: true, data: booking });
    });

    const { onSaved } = renderForm();
    await waitFor(() => screen.getByRole("option", { name: "Беседка №1" }));

    fireEvent.click(screen.getByText("Сохранить"));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const patchCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes("/bookings/booking-1"));
    const body = JSON.parse((patchCall![1] as RequestInit).body as string);
    expect(body).toMatchObject({ resourceId: "resource-1", date: "2026-09-01" });
  });
});
