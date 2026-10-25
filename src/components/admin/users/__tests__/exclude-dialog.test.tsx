// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ExcludeDialog, EXCLUDE_TEXTS } from "../exclude-dialog";

/** PRD 2026-10-25 US-A1/US-A2 — окно «Исключить из команды». */

type Preview = {
  user: { id: string; name: string | null; role: string };
  isSeededSuperadmin: boolean;
  removes: {
    sectionsByRole: string[];
    explicitSections: string[];
    modules: string[];
    recipientLists: string[];
    subscriptions: string[];
  };
  counts: { sections: number; modules: number; recipientLists: number; subscriptions: number };
  openAssignedTasks: number;
  guard: null | { code: string; message: string };
};

const basePreview: Preview = {
  user: { id: "mgr-1", name: "Иван", role: "MANAGER" },
  isSeededSuperadmin: false,
  removes: {
    sectionsByRole: [],
    explicitSections: ["Дашборд", "Кафе", "Задачи"],
    modules: ["Кафе", "Барбекю Парк"],
    recipientLists: ["Кафе", "Аренда офисов"],
    subscriptions: ["Новый заказ", "Отмена заказа", "Новая бронь", "Релизы платформы"],
  },
  counts: { sections: 3, modules: 2, recipientLists: 2, subscriptions: 4 },
  openAssignedTasks: 3,
  guard: null,
};

const exclusionResult = {
  userId: "mgr-1",
  role: "USER",
  removed: { sections: [], modules: [], recipientLists: [], subscriptions: [] },
  sessionsRevoked: true,
};

function mockFetch(preview: Preview, submit: unknown = { success: true, data: exclusionResult }) {
  const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
    Promise.resolve({
      json: () => Promise.resolve(init?.method ? submit : { success: true, data: preview }),
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ExcludeDialog", () => {
  it("AC-A1.2: shows name, role, what is removed (counts), what stays and open tasks", async () => {
    mockFetch(basePreview);
    render(<ExcludeDialog userId="mgr-1" userName="Иван" onClose={vi.fn()} onExcluded={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Разделы админки — 3")).toBeTruthy());
    expect(screen.getByText("Иван — Менеджер")).toBeTruthy();
    expect(screen.getByText("Назначения на модули — 2")).toBeTruthy();
    expect(screen.getByText("Списки получателей уведомлений — 2")).toBeTruthy();
    expect(screen.getByText("Личные подписки на уведомления — 4")).toBeTruthy();
    expect(screen.getByText(EXCLUDE_TEXTS.keeps)).toBeTruthy();
    expect(screen.getByText(/Открытых задач, где он исполнитель: 3/)).toBeTruthy();
    expect(screen.queryByText(EXCLUDE_TEXTS.seededWarning)).toBeNull();
  });

  it("AC-A1.3: confirming POSTs to /exclude and reports the result", async () => {
    const fetchMock = mockFetch(basePreview);
    const onExcluded = vi.fn();
    render(<ExcludeDialog userId="mgr-1" userName="Иван" onClose={vi.fn()} onExcluded={onExcluded} />);

    const action = await screen.findByRole("button", { name: EXCLUDE_TEXTS.action });
    fireEvent.click(action);

    await waitFor(() => expect(onExcluded).toHaveBeenCalledWith(exclusionResult));
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("/api/users/mgr-1/exclude");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({});
  });

  it("AC-A1.7: seeded superadmin — warning, action disabled until «Всё равно исключить», then confirmSeeded", async () => {
    const fetchMock = mockFetch({
      ...basePreview,
      user: { id: "sa-seed", name: "Владелец", role: "SUPERADMIN" },
      isSeededSuperadmin: true,
    });
    const onExcluded = vi.fn();
    render(<ExcludeDialog userId="sa-seed" userName="Владелец" onClose={vi.fn()} onExcluded={onExcluded} />);

    await waitFor(() => expect(screen.getByText(EXCLUDE_TEXTS.seededWarning)).toBeTruthy());
    const action = screen.getByRole("button", { name: EXCLUDE_TEXTS.action }) as HTMLButtonElement;
    expect(action.disabled).toBe(true);

    fireEvent.click(screen.getByLabelText(EXCLUDE_TEXTS.seededConfirm));
    expect(action.disabled).toBe(false);
    fireEvent.click(action);

    await waitFor(() => expect(onExcluded).toHaveBeenCalled());
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ confirmSeeded: true });
  });

  it("AC-A1.6: a guard shows its message and no action button", async () => {
    mockFetch({
      ...basePreview,
      guard: { code: "LAST_SUPERADMIN", message: "Нельзя исключить последнего суперадмина. Сначала назначьте другого" },
    });
    render(<ExcludeDialog userId="sa-1" userName="Владелец" onClose={vi.fn()} onExcluded={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText("Нельзя исключить последнего суперадмина. Сначала назначьте другого")).toBeTruthy(),
    );
    expect(screen.queryByRole("button", { name: EXCLUDE_TEXTS.action })).toBeNull();
  });

  it("AC-A1.8: a server error (already excluded) is shown inside the window, not via alert()", async () => {
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);
    mockFetch(basePreview, {
      success: false,
      error: { code: "ALREADY_EXCLUDED", message: "Пользователь уже не входит в команду" },
    });
    const onExcluded = vi.fn();
    render(<ExcludeDialog userId="mgr-1" userName="Иван" onClose={vi.fn()} onExcluded={onExcluded} />);

    fireEvent.click(await screen.findByRole("button", { name: EXCLUDE_TEXTS.action }));

    await waitFor(() => expect(screen.getByText("Пользователь уже не входит в команду")).toBeTruthy());
    expect(onExcluded).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("AC-A1.7: a SEEDED_SUPERADMIN_CONFIRM_REQUIRED answer reveals the seeded confirmation", async () => {
    mockFetch(basePreview, {
      success: false,
      error: { code: "SEEDED_SUPERADMIN_CONFIRM_REQUIRED", message: EXCLUDE_TEXTS.seededWarning },
    });
    render(<ExcludeDialog userId="mgr-1" userName="Иван" onClose={vi.fn()} onExcluded={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: EXCLUDE_TEXTS.action }));

    await waitFor(() => expect(screen.getByLabelText(EXCLUDE_TEXTS.seededConfirm)).toBeTruthy());
  });

  it("AC-A2.1: role-change mode PATCHes role USER and returns the exclusion from the response", async () => {
    const fetchMock = mockFetch(basePreview, {
      success: true,
      data: { id: "mgr-1", role: "USER", exclusion: exclusionResult },
    });
    const onExcluded = vi.fn();
    render(
      <ExcludeDialog userId="mgr-1" userName="Иван" submitVia="role_change" onClose={vi.fn()} onExcluded={onExcluded} />,
    );

    fireEvent.click(await screen.findByRole("button", { name: EXCLUDE_TEXTS.action }));

    await waitFor(() => expect(onExcluded).toHaveBeenCalledWith(exclusionResult));
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("/api/users/mgr-1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ role: "USER" });
  });
});
