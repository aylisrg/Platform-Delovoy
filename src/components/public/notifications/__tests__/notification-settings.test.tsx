// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NotificationSettings } from "../notification-settings";
const preference = {
  preferredChannel: "AUTO",
  enableBooking: true,
  enableOrder: false,
  enableReminder: true,
};
const fetchMock = vi.fn();
const response = (data: unknown, ok = true) =>
  ({ ok, json: async () => data }) as Response;
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("notification settings", () => {
  it("does not show editable default preferences when loading failed and supports retry", async () => {
    fetchMock
      .mockResolvedValueOnce(response({ success: false }, false))
      .mockResolvedValueOnce(
        response({
          success: true,
          data: { preference, availableChannels: ["EMAIL"] },
        }),
      );
    render(<NotificationSettings />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Сохранить настройки" }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Повторить загрузку настроек" }),
    );
    expect(
      await screen.findByRole("combobox", {
        name: "Куда отправлять уведомления",
      }),
    ).toBeTruthy();
    expect(
      (screen.getAllByRole("checkbox")[1] as HTMLInputElement).checked,
    ).toBe(false);
  });
  it("shows a server save failure and retains the user's selection for retry", async () => {
    fetchMock
      .mockResolvedValueOnce(
        response({
          success: true,
          data: { preference, availableChannels: ["EMAIL"] },
        }),
      )
      .mockResolvedValueOnce(
        response(
          { success: false, error: { message: "Сервис временно недоступен" } },
          false,
        ),
      )
      .mockResolvedValueOnce(
        response({
          success: true,
          data: { ...preference, enableBooking: false },
        }),
      );
    render(<NotificationSettings />);
    fireEvent.click((await screen.findAllByRole("checkbox"))[0]);
    fireEvent.click(
      screen.getByRole("button", { name: "Сохранить настройки" }),
    );
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Сервис временно недоступен",
    );
    expect(
      (screen.getAllByRole("checkbox")[0] as HTMLInputElement).checked,
    ).toBe(false);
    expect(screen.queryByText("Настройки сохранены")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Сохранить настройки" }),
    );
    expect(await screen.findByText("Настройки сохранены")).toBeTruthy();
  });
});
