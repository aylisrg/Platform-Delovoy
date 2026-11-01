// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

/**
 * Таб «Все» (ADR 2026-10-25 §7): все alert()/confirm() → диалоги; «Пользователь»
 * у сотрудника → окно исключения; «Удалить» → при 409 окно с блокерами.
 */

vi.mock("next/image", () => ({
  default: (props: { alt?: string }) => <span data-testid="avatar">{props.alt}</span>,
}));
vi.mock("../create-user-form", () => ({ CreateUserForm: () => null }));

import { UsersList } from "../users-list";

const manager = {
  id: "mgr-1",
  name: "Иван",
  email: "ivan@example.com",
  role: "MANAGER",
  phone: null,
  image: null,
  telegramId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  notificationPreference: { notifyReleases: true },
  authProviders: ["credentials"],
};

const preview = {
  user: { id: "mgr-1", name: "Иван", role: "MANAGER" },
  isSeededSuperadmin: false,
  removes: { sectionsByRole: [], explicitSections: [], modules: [], recipientLists: [], subscriptions: [] },
  counts: { sections: 0, modules: 0, recipientLists: 0, subscriptions: 0 },
  openAssignedTasks: 0,
  guard: null,
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    let body: unknown = { success: true, data: [manager], meta: { total: 1 } };
    if (url === "/api/users/mgr-1/exclude") body = { success: true, data: preview };
    if (url === "/api/users/mgr-1" && method === "DELETE") {
      body = {
        success: false,
        error: {
          code: "USER_HAS_HISTORY",
          message: "Удалить нельзя",
          metadata: {
            blockers: [{ type: "AuditLog", label: "Журнал действий", count: 214 }],
            isTeamMember: true,
          },
        },
      };
    }
    return Promise.resolve({ json: () => Promise.resolve(body) });
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("alert", vi.fn());
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderList() {
  render(<UsersList />);
  await screen.findByText("Иван");
}

describe("UsersList dialogs", () => {
  it("AC-A2.1: choosing «Пользователь» for a team member opens the exclusion window, no direct PATCH", async () => {
    await renderList();

    fireEvent.click(screen.getByTitle("Нажмите для изменения роли"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "USER" } });

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Исключить из команды", { selector: "h2" })).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/users/mgr-1/exclude"));
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "PATCH")).toBe(false);
  });

  it("AC-A1.1: a team row has «Исключить из команды»", async () => {
    await renderList();
    fireEvent.click(screen.getByRole("button", { name: "Исключить из команды" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("AC-A3.1: «Удалить» asks in a dialog (no confirm()) and shows blockers on 409", async () => {
    await renderList();

    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
    const confirmDialog = await screen.findByRole("dialog");
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "Удалить" }));

    await waitFor(() => expect(screen.getByText("Удалить нельзя: у аккаунта есть история")).toBeTruthy());
    expect(screen.getByText("Журнал действий — 214")).toBeTruthy();
    expect(window.confirm).not.toHaveBeenCalled();
    expect(window.alert).not.toHaveBeenCalled();

    // AC-A3.3: the main action of the blocked window opens the exclusion.
    const blockedDialog = screen.getByRole("dialog");
    fireEvent.click(within(blockedDialog).getByRole("button", { name: "Исключить из команды" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/users/mgr-1/exclude"));
    expect(within(screen.getByRole("dialog")).getByText("Исключить из команды", { selector: "h2" })).toBeTruthy();
  });
});
