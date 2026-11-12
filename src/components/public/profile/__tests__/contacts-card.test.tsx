// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
const refresh = vi.fn();
const update = vi.fn();
const fetchMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ update }) }));
vi.mock("@/components/public/dashboard/tracking", () => ({
  trackDashboard: vi.fn(),
}));
import { ContactsCard } from "../contacts-card";
const profile = {
  id: "u1",
  name: "Анна",
  image: null,
  contacts: {
    telegram: null,
    yandex: null,
    email: "a@example.invalid",
    phone: null,
  },
};
const response = (data: unknown, ok = true) =>
  ({ ok, json: async () => data }) as Response;
beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  window.history.replaceState({}, "", "/dashboard?section=profile");
  vi.stubGlobal("fetch", fetchMock);
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("profile contacts", () => {
  it("shows a retry when profile loading failed", async () => {
    fetchMock
      .mockResolvedValueOnce(response({ success: false }, false))
      .mockResolvedValue(response({ success: true, data: profile }));
    render(<ContactsCard />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Повторить загрузку контактов" }),
    );
    expect(await screen.findByText("Анна")).toBeTruthy();
    expect(screen.queryByText("Привязать Яндекс")).toBeNull();
  });
  it("shows Telegram errors instead of silently doing nothing", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/profile"
        ? response({ success: true, data: profile })
        : response(
            { success: false, error: { message: "Бот недоступен" } },
            false,
          ),
    );
    render(<ContactsCard />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Добавить Telegram" }),
    );
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Бот недоступен",
    );
  });
  it("automatically confirms an email link once and removes the token from the URL", async () => {
    const token = "a".repeat(64);
    window.history.replaceState({}, "", `/dashboard?attachEmail=${token}`);
    fetchMock.mockResolvedValue(response({ success: true, data: profile }));
    render(<ContactsCard initialEmailToken={token} />);
    expect(
      await screen.findByText("Email подтверждён и привязан к аккаунту"),
    ).toBeTruthy();
    expect(
      fetchMock.mock.calls.filter(
        ([url]) => url === "/api/profile/contacts/email/confirm",
      ),
    ).toHaveLength(1);
    expect(window.location.search).not.toContain("attachEmail");
    expect(screen.queryByDisplayValue(token)).toBeNull();
    expect(update).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });
  it("keeps a failed link retryable without showing a technical token", async () => {
    const token = "b".repeat(64);
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/profile"
        ? response({ success: true, data: profile })
        : response(
            { success: false, error: { message: "Ссылка истекла" } },
            false,
          ),
    );
    render(<ContactsCard initialEmailToken={token} />);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Ссылка истекла",
    );
    expect(
      screen.getByRole("button", { name: "Повторить подтверждение" }),
    ).toBeTruthy();
    expect(screen.queryByText(token)).toBeNull();
  });
  it("uses a labelled name field and refreshes session and header after saving", async () => {
    fetchMock.mockResolvedValue(response({ success: true, data: profile }));
    render(<ContactsCard />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Изменить имя" }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Ваше имя" }), {
      target: { value: "Мария" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить имя" }));
    expect(await screen.findByText("Имя сохранено")).toBeTruthy();
    expect(update).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/profile",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ name: "Мария" }),
      }),
    );
  });
  it("opens an accessible detach dialog with the safe action focused", async () => {
    fetchMock.mockResolvedValue(response({ success: true, data: profile }));
    render(<ContactsCard />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Отвязать Email" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Отвязать контакт?",
    });
    expect(dialog).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement?.textContent).toBe("Оставить контакт"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Оставить контакт" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
