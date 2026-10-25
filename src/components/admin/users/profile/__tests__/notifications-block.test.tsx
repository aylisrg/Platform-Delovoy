// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NotificationsBlock } from "../notifications-block";

const explain = {
  userId: "u1",
  role: "MANAGER",
  botStatus: { state: "STARTED", startedAt: null },
  channels: [{ kind: "TELEGRAM", label: "Telegram", order: 1, deliverable: true }],
  globalNotes: [],
  categories: [
    {
      key: "bookings", label: "Бронирования", description: "", icon: "calendar", delivery: "personal",
      access: { ok: true },
      groupChat: [{ moduleSlug: "gazebos", moduleLabel: "Барбекю Парк", receives: false }],
      events: [
        {
          eventType: "booking.created", label: "Новая бронь", description: "", status: "RECEIVES",
          toggle: { enabled: true, editable: true, source: "explicit" },
          paths: [{ kind: "module_list", label: "Список получателей раздела «Барбекю Парк»", moduleSlug: "gazebos" }],
          contexts: [], deliveryChannels: [{ kind: "TELEGRAM", label: "Telegram" }], blockers: [], notes: [],
          lastChange: { byName: "Владелец", via: "admin", at: "2026-10-25T07:00:00.000Z" },
        },
      ],
    },
    {
      key: "cafe", label: "Кафе", description: "", icon: "cafe", delivery: "personal",
      access: { ok: false, reason: "NO_SECTION", label: "Нет доступа к разделу «Кафе»" },
      groupChat: [],
      events: [
        {
          eventType: "order.placed", label: "Новый заказ", description: "", status: "NO_ACCESS",
          toggle: { enabled: false, editable: false, source: "default" },
          paths: [], contexts: [], deliveryChannels: [], blockers: [], notes: [], lastChange: null,
        },
      ],
    },
  ],
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ success: true, data: explain }) }) as Response);
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("NotificationsBlock (US-C1/C2)", () => {
  it("AC-C1.2/C1.3/C1.7/C2.3: status, path, channel, group chat line, last change; no-access greyed", async () => {
    render(<NotificationsBlock userId="u1" />);
    expect(await screen.findByText("Получает")).toBeTruthy();
    expect(screen.getByText("Путь: Список получателей раздела «Барбекю Парк»")).toBeTruthy();
    expect(screen.getByText("Общий чат раздела «Барбекю Парк» получает это событие: нет")).toBeTruthy();
    expect(screen.getByText(/Изменено: Владелец/)).toBeTruthy();
    expect(screen.getByText("Нет доступа к разделу «Кафе»")).toBeTruthy();
    expect((screen.getByRole("switch", { name: "Новый заказ" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("AC-C2.1: the toggle PATCHes the shared subscription and re-reads the truth", async () => {
    render(<NotificationsBlock userId="u1" />);
    fireEvent.click(await screen.findByRole("switch", { name: "Новая бронь" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/users/u1/notifications", expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ eventType: "booking.created", enabled: false, source: "profile" }),
      })),
    );
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => !init).length).toBeGreaterThanOrEqual(2));
  });

  it("shows the server error and keeps the screen", async () => {
    fetchMock.mockImplementation(async (_u: string, init?: RequestInit) =>
      ({
        ok: true,
        json: async () =>
          init?.method === "PATCH"
            ? { success: false, error: { message: "Нет доступа к разделу «Кафе»" } }
            : { success: true, data: explain },
      }) as Response,
    );
    render(<NotificationsBlock userId="u1" />);
    fireEvent.click(await screen.findByRole("switch", { name: "Новая бронь" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});
