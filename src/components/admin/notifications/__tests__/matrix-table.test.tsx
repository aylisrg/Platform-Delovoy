// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MatrixTable } from "../matrix-table";

const matrix = {
  events: [
    { eventType: "booking.created", label: "Новая бронь", categoryKey: "bookings", categoryLabel: "Бронирования" },
    { eventType: "order.placed", label: "Новый заказ", categoryKey: "cafe", categoryLabel: "Кафе" },
  ],
  rows: [
    {
      user: { id: "u1", name: "Анна", role: "MANAGER" },
      cells: {
        "booking.created": { status: "RECEIVES", editable: true, enabled: true },
        "order.placed": { status: "NO_ACCESS", reason: "Нет доступа к разделу «Кафе»", editable: false, enabled: false },
      },
    },
  ],
  totals: {
    "booking.created": { personalRecipients: 1, groupChatOnly: false },
    "order.placed": { personalRecipients: 0, groupChatOnly: true },
  },
};

const fetchMock = vi.fn();
const ok = (data: unknown) => ({ json: async () => ({ success: true, data }) });

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(ok(matrix));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MatrixTable (US-C4)", () => {
  it("AC-C4.2/C4.4: cells by status, staff links, «только общий чат» for events nobody gets personally", async () => {
    render(<MatrixTable />);
    expect((await screen.findByRole("link", { name: "Анна" })).getAttribute("href")).toBe("/admin/users/u1");
    expect((screen.getByRole("button", { name: "Анна — Новая бронь: Получает" }) as HTMLButtonElement).disabled).toBe(false);
    const noAccess = screen.getByRole("button", { name: "Анна — Новый заказ: Нет доступа" }) as HTMLButtonElement;
    expect(noAccess.disabled).toBe(true);
    expect(noAccess.title).toBe("Нет доступа: Нет доступа к разделу «Кафе»");
    expect(screen.getByText("только общий чат")).toBeTruthy();
  });

  it("AC-C4.5: a click is the same toggle as the staff page, tagged as matrix", async () => {
    render(<MatrixTable />);
    fireEvent.click(await screen.findByRole("button", { name: "Анна — Новая бронь: Получает" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/users/u1/notifications");
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1].body)).toEqual({
      eventType: "booking.created",
      enabled: false,
      source: "matrix",
    });
  });

  it("keeps the server error visible instead of reloading over it", async () => {
    render(<MatrixTable />);
    const cell = await screen.findByRole("button", { name: "Анна — Новая бронь: Получает" });
    fetchMock.mockResolvedValueOnce({
      json: async () => ({ success: false, error: { code: "NO_ACCESS_TO_CATEGORY", message: "Нет доступа к разделу" } }),
    });
    fireEvent.click(cell);
    expect(await screen.findByText("Нет доступа к разделу")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("filters go to the API query", async () => {
    render(<MatrixTable />);
    await screen.findByRole("link", { name: "Анна" });
    fireEvent.change(screen.getByLabelText("Роль"), { target: { value: "MANAGER" } });
    fireEvent.click(screen.getByLabelText("Только проблемы"));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith("/api/admin/notifications/matrix?role=MANAGER&problems=true"),
    );
  });

  it("category options come from the catalog, so picking one doesn't hide the others", async () => {
    render(<MatrixTable />);
    await screen.findByRole("link", { name: "Анна" });
    const select = screen.getByLabelText("Категория") as HTMLSelectElement;
    const before = [...select.options].map((o) => o.value);
    expect(before.length).toBeGreaterThan(3);
    fireEvent.change(select, { target: { value: "cafe" } });
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith("/api/admin/notifications/matrix?category=cafe"));
    expect([...select.options].map((o) => o.value)).toEqual(before);
  });

  it("a late answer to an older filter doesn't overwrite the newer one", async () => {
    let releaseOld: (v: unknown) => void = () => undefined;
    fetchMock.mockReset();
    fetchMock
      .mockImplementationOnce(() => new Promise((resolve) => (releaseOld = resolve)))
      .mockResolvedValue(ok({ ...matrix, rows: [{ ...matrix.rows[0], user: { id: "u2", name: "Борис", role: "ADMIN" } }] }));
    render(<MatrixTable />);
    fireEvent.change(screen.getByLabelText("Роль"), { target: { value: "ADMIN" } });
    expect(await screen.findByRole("link", { name: "Борис" })).toBeTruthy();
    releaseOld(ok(matrix));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("link", { name: "Анна" })).toBeNull();
  });
});
