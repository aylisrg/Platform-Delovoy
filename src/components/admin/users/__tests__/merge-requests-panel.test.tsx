// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MergeRequestsPanel } from "../merge-requests-panel";

/** PRD 2026-10-25 AC-E4.3 — очередь «Запросы на объединение». */

const item = {
  id: "mc-1",
  detectedAt: "2026-10-01T00:00:00.000Z",
  matchedFields: ["telegramId"],
  reasonLabel: "Telegram уже привязан к другому аккаунту",
  users: [
    { id: "s-bot", name: "Петя из бота", role: "USER", email: null, phone: null, hasTelegram: true, createdAt: "" },
    { id: "p-mgr", name: "Пётр", role: "MANAGER", email: "petr@mail.ru", phone: null, hasTelegram: false, createdAt: "" },
  ],
};

function mockFetch(list: unknown, patch: unknown = { success: true, data: { id: "mc-1", status: "RESOLVED_KEPT_SEPARATE" } }) {
  const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
    Promise.resolve({ json: () => Promise.resolve(init?.method === "PATCH" ? patch : list) }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MergeRequestsPanel", () => {
  it("AC-E4.3: shows the counter and the pairs; «Объединить» hands the pair up", async () => {
    mockFetch({ success: true, data: [item], meta: { total: 1 } });
    const onMerge = vi.fn();
    render(<MergeRequestsPanel onMerge={onMerge} />);

    expect(await screen.findByText("Запросы на объединение: 1")).toBeTruthy();
    expect(screen.getByText("Telegram уже привязан к другому аккаунту")).toBeTruthy();
    expect(screen.getByText("Петя из бота")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Объединить" }));
    expect(onMerge).toHaveBeenCalledWith({ userAId: "s-bot", userBId: "p-mgr", mergeRequestId: "mc-1" });
  });

  it("AC-E4.3: «Это разные люди» → confirmation → PATCH dismiss → the request disappears", async () => {
    const fetchMock = mockFetch({ success: true, data: [item] });
    render(<MergeRequestsPanel onMerge={vi.fn()} />);
    await screen.findByText("Запросы на объединение: 1");

    fireEvent.click(screen.getByRole("button", { name: "Это разные люди" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(dialog.querySelector("button.bg-blue-600") as HTMLButtonElement);

    await waitFor(() => expect(screen.getByText("Запросы на объединение: 0")).toBeTruthy());
    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")!;
    expect(patchCall[0]).toBe("/api/users/merge-requests/mc-1");
    expect(JSON.parse(String(patchCall[1]?.body))).toEqual({ action: "dismiss" });
    expect(screen.getByText("Открытых запросов нет.")).toBeTruthy();
  });

  it("keeps the request and shows the error when dismiss fails", async () => {
    mockFetch({ success: true, data: [item] }, { success: false, error: { code: "INTERNAL_ERROR", message: "Не удалось" } });
    render(<MergeRequestsPanel onMerge={vi.fn()} />);
    await screen.findByText("Запросы на объединение: 1");
    fireEvent.click(screen.getByRole("button", { name: "Это разные люди" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(dialog.querySelector("button.bg-blue-600") as HTMLButtonElement);

    expect(await screen.findByText("Не удалось")).toBeTruthy();
    expect(screen.getByText("Запросы на объединение: 1")).toBeTruthy();
  });

  it("shows the load error", async () => {
    mockFetch({ success: false, error: { message: "Доступ запрещён" } });
    render(<MergeRequestsPanel onMerge={vi.fn()} />);
    expect(await screen.findByText("Доступ запрещён")).toBeTruthy();
  });
});
