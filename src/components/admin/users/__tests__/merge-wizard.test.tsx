// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MergeWizard, MERGE_TEXTS } from "../merge-wizard";
import type { AccountMergePreview, AccountSide } from "@/modules/clients/types";

/** PRD 2026-10-25 US-E2 — мастер «Объединить аккаунты» (ADR §7 «Диалоги»). */

function side(overrides: Partial<AccountSide>): AccountSide {
  return {
    id: "x",
    name: "Без имени",
    role: "USER",
    email: null,
    phone: null,
    hasTelegram: false,
    hasVk: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    source: null,
    isSeededSuperadmin: false,
    botStatus: { state: "NOT_LINKED" },
    ...overrides,
  };
}

const MGR = side({ id: "p-mgr", name: "Пётр", role: "MANAGER", email: "petr@mail.ru" });
const BOT = side({ id: "s-bot", name: "Петя из бота", hasTelegram: true });

function preview(primary: AccountSide, secondary: AccountSide, extra: Partial<AccountMergePreview> = {}): AccountMergePreview {
  return {
    primary,
    secondary,
    suggestedPrimaryId: "p-mgr",
    result: { role: primary.role, name: primary.name, email: primary.email, phone: null, telegramLinked: true, vkLinked: false },
    conflicts: [],
    access: { sections: ["Кафе"], modules: ["Кафе"], recipientLists: [] },
    subscriptions: { kept: [], moved: [], droppedConflicts: [] },
    channels: { kept: [], moved: ["Telegram"], duplicates: [] },
    transfer: { bookings: 2, orders: 0, subscriptions: 0, tasks: 0, chatMessages: 0, auditLogs: 1, notifications: 0 },
    notTransferred: [],
    blockers: [],
    ...extra,
  };
}

type Handler = (url: string, init?: RequestInit) => unknown;

function mockFetch(handler: Handler) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) =>
    Promise.resolve({ json: () => Promise.resolve(handler(url, init)) }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const body = (init?: RequestInit) => JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MergeWizard", () => {
  it("renders nothing when closed", () => {
    mockFetch(() => ({ success: true, data: [] }));
    const { container } = render(<MergeWizard open={false} onClose={vi.fn()} onMerged={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });

  it("AC-E2.2–E2.5: pre-filled pair → «Кого оставить» (suggested by default) → preview → irreversible checkbox → merge", async () => {
    const onMerged = vi.fn();
    const fetchMock = mockFetch((url) => {
      if (url === "/api/users/merge/preview") return { success: true, data: preview(MGR, BOT) };
      if (url === "/api/users/merge") return { success: true, data: { primaryId: "p-mgr" } };
      return { success: false };
    });

    render(
      <MergeWizard open initialUserId="s-bot" initialSecondaryId="p-mgr" mergeRequestId="mc-1" onClose={vi.fn()} onMerged={onMerged} />,
    );

    const radios = await screen.findAllByRole("radio");
    expect(body(fetchMock.mock.calls[0][1])).toEqual({ primaryId: "s-bot", secondaryId: "p-mgr" });
    expect((radios[0] as HTMLInputElement).checked).toBe(true); // Пётр = suggestedPrimaryId
    expect(screen.getByText("рекомендуем")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Показать превью" }));
    await screen.findByTestId("merge-preview");
    expect(screen.getByTestId("merge-transfer").textContent).toContain("Брони — 2");

    // The bot account's Telegram moves to the primary: the person signs in either way into one account.
    expect(screen.getByTestId("merge-preview").textContent).toContain("Вход через Telegram будет вести в аккаунт Пётр");

    const submit = screen.getByRole("button", { name: MERGE_TEXTS.submit }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(screen.getByTestId("merge-submit-hint").textContent).toBe(MERGE_TEXTS.hintConfirm);
    expect(submit.getAttribute("aria-describedby")).toBe(screen.getByTestId("merge-submit-hint").id);
    fireEvent.click(screen.getByLabelText(MERGE_TEXTS.irreversible));
    expect(submit.disabled).toBe(false);
    expect(screen.queryByTestId("merge-submit-hint")).toBeNull();
    fireEvent.click(submit);

    await waitFor(() => expect(onMerged).toHaveBeenCalledWith({ primaryId: "p-mgr" }));
    const mergeCall = fetchMock.mock.calls.find(([u]) => u === "/api/users/merge")!;
    expect(body(mergeCall[1])).toEqual({ primaryId: "p-mgr", secondaryId: "s-bot", confirmIrreversible: true });
  });

  it("choosing the other account as primary re-requests the preview with swapped ids", async () => {
    const fetchMock = mockFetch((url, init) => {
      const b = body(init);
      if (url === "/api/users/merge/preview") {
        return { success: true, data: b.primaryId === "p-mgr" ? preview(MGR, BOT) : preview(BOT, MGR) };
      }
      return { success: false };
    });
    render(<MergeWizard open initialUserId="p-mgr" initialSecondaryId="s-bot" onClose={vi.fn()} onMerged={vi.fn()} />);

    const radios = await screen.findAllByRole("radio");
    fireEvent.click(radios[1]);
    fireEvent.click(screen.getByRole("button", { name: "Показать превью" }));
    await screen.findByTestId("merge-preview");

    const last = fetchMock.mock.calls.at(-1)!;
    expect(body(last[1])).toEqual({ primaryId: "s-bot", secondaryId: "p-mgr" });
  });

  it("AC-E2.4г: a Telegram conflict needs its own checkbox; the request confirms it", async () => {
    const withConflict = preview(MGR, BOT, {
      conflicts: [{ field: "telegram", primaryValue: "привязан", secondaryValue: "привязан", requiresConfirmation: true }],
    });
    const fetchMock = mockFetch((url) =>
      url === "/api/users/merge/preview"
        ? { success: true, data: withConflict }
        : { success: true, data: { primaryId: "p-mgr" } },
    );
    render(<MergeWizard open initialUserId="p-mgr" initialSecondaryId="s-bot" onClose={vi.fn()} onMerged={vi.fn()} />);
    await screen.findAllByRole("radio");
    fireEvent.click(screen.getByRole("button", { name: "Показать превью" }));
    await screen.findByTestId("merge-conflicts");

    const submit = screen.getByRole("button", { name: MERGE_TEXTS.submit }) as HTMLButtonElement;
    fireEvent.click(screen.getByLabelText(MERGE_TEXTS.irreversible));
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(MERGE_TEXTS.telegramConfirm));
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);

    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => u === "/api/users/merge")).toBe(true));
    const mergeCall = fetchMock.mock.calls.find(([u]) => u === "/api/users/merge")!;
    expect(body(mergeCall[1])).toMatchObject({ confirmTelegramConflict: true });
  });

  it("blockers are shown and the merge can't be confirmed", async () => {
    const blocked = preview(MGR, BOT, {
      blockers: [{ code: "SECONDARY_IS_ACTOR", message: "Нельзя объединить аккаунт, под которым вы вошли. Выберите его основным" }],
    });
    mockFetch(() => ({ success: true, data: blocked }));
    render(<MergeWizard open initialUserId="p-mgr" initialSecondaryId="s-bot" onClose={vi.fn()} onMerged={vi.fn()} />);
    await screen.findAllByRole("radio");
    fireEvent.click(screen.getByRole("button", { name: "Показать превью" }));

    const reason = "Нельзя объединить аккаунт, под которым вы вошли. Выберите его основным";
    // Top of the preview, bottom of the preview, next to the button.
    expect(await screen.findAllByText(reason)).toHaveLength(3);
    expect(screen.queryByLabelText(MERGE_TEXTS.irreversible)).toBeNull();
    expect((screen.getByRole("button", { name: MERGE_TEXTS.submit }) as HTMLButtonElement).disabled).toBe(true);
    // The top of a long preview is scrolled away on a phone: the reason is also
    // at the bottom, where the checkbox would be, and next to the button.
    expect(screen.getByTestId("merge-blockers-bottom").textContent).toContain(reason);
    expect(screen.getByTestId("merge-submit-hint").textContent).toBe(reason);
  });

  it("several blockers: all of them at the bottom and next to the button", async () => {
    const blocked = preview(MGR, BOT, {
      blockers: [
        { code: "SECONDARY_IS_ACTOR", message: "Нельзя объединить аккаунт, под которым вы вошли. Выберите его основным" },
        { code: "ACTIVE_SUBSCRIPTION_CONFLICT", message: "У обоих аккаунтов активный абонемент — объединение невозможно, пока один не завершён" },
      ],
    });
    mockFetch(() => ({ success: true, data: blocked }));
    render(<MergeWizard open initialUserId="p-mgr" initialSecondaryId="s-bot" onClose={vi.fn()} onMerged={vi.fn()} />);
    await screen.findAllByRole("radio");
    fireEvent.click(screen.getByRole("button", { name: "Показать превью" }));
    await screen.findByTestId("merge-preview");

    for (const b of blocked.blockers) {
      expect(screen.getByTestId("merge-blockers-bottom").textContent).toContain(b.message);
    }
    // One reason per line — the messages carry no trailing dot, so they must not run together.
    expect(screen.getByTestId("merge-submit-hint").textContent).toBe(blocked.blockers.map((b) => b.message).join("\n"));
  });

  it("no hint while the merge is being sent", async () => {
    let release: (v: unknown) => void = () => undefined;
    const fetchMock = vi.fn((url: string) =>
      url === "/api/users/merge"
        ? new Promise((resolve) => (release = resolve))
        : Promise.resolve({ json: () => Promise.resolve({ success: true, data: preview(MGR, BOT) }) }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<MergeWizard open initialUserId="p-mgr" initialSecondaryId="s-bot" onClose={vi.fn()} onMerged={vi.fn()} />);
    await screen.findAllByRole("radio");
    fireEvent.click(screen.getByRole("button", { name: "Показать превью" }));
    await screen.findByTestId("merge-preview");
    fireEvent.click(screen.getByLabelText(MERGE_TEXTS.irreversible));
    fireEvent.click(screen.getByRole("button", { name: MERGE_TEXTS.submit }));

    expect(await screen.findByRole("button", { name: "Объединяем..." })).toBeTruthy();
    expect(screen.queryByTestId("merge-submit-hint")).toBeNull();
    release({ json: () => Promise.resolve({ success: true, data: { primaryId: "p-mgr" } }) });
  });

  it("a disabled «Объединить» says what's missing: the confirmation, then the Telegram choice", async () => {
    const withConflict = preview(MGR, BOT, {
      conflicts: [{ field: "telegram", primaryValue: "привязан", secondaryValue: "привязан", requiresConfirmation: true }],
    });
    mockFetch(() => ({ success: true, data: withConflict }));
    render(<MergeWizard open initialUserId="p-mgr" initialSecondaryId="s-bot" onClose={vi.fn()} onMerged={vi.fn()} />);
    await screen.findAllByRole("radio");
    fireEvent.click(screen.getByRole("button", { name: "Показать превью" }));
    await screen.findByTestId("merge-preview");

    expect(screen.getByTestId("merge-submit-hint").textContent).toBe(MERGE_TEXTS.hintConfirm);
    fireEvent.click(screen.getByLabelText(MERGE_TEXTS.irreversible));
    expect(screen.getByTestId("merge-submit-hint").textContent).toBe(MERGE_TEXTS.hintTelegram);
    fireEvent.click(screen.getByLabelText(MERGE_TEXTS.telegramConfirm));
    expect(screen.queryByTestId("merge-submit-hint")).toBeNull();
  });

  it("shows the server error of the merge (e.g. ALREADY_MERGED) inside the dialog", async () => {
    const onMerged = vi.fn();
    mockFetch((url) =>
      url === "/api/users/merge/preview"
        ? { success: true, data: preview(MGR, BOT) }
        : { success: false, error: { code: "ALREADY_MERGED", message: "Этот аккаунт уже объединён с другим" } },
    );
    render(<MergeWizard open initialUserId="p-mgr" initialSecondaryId="s-bot" onClose={vi.fn()} onMerged={onMerged} />);
    await screen.findAllByRole("radio");
    fireEvent.click(screen.getByRole("button", { name: "Показать превью" }));
    await screen.findByTestId("merge-preview");
    fireEvent.click(screen.getByLabelText(MERGE_TEXTS.irreversible));
    fireEvent.click(screen.getByRole("button", { name: MERGE_TEXTS.submit }));

    expect(await screen.findByText("Этот аккаунт уже объединён с другим")).toBeTruthy();
    expect(onMerged).not.toHaveBeenCalled();
  });

  it("AC-E2.1: from one account — «Возможные дубли» and search pick the second account", async () => {
    const fetchMock = mockFetch((url) => {
      if (url.startsWith("/api/users/merge-requests")) {
        return {
          success: true,
          data: [
            {
              id: "mc-1",
              detectedAt: "2026-10-01T00:00:00.000Z",
              matchedFields: ["telegramId"],
              reasonLabel: "Telegram уже привязан к другому аккаунту",
              users: [
                { id: "p-mgr", name: "Пётр", role: "MANAGER", email: null, phone: null, hasTelegram: false, createdAt: "" },
                { id: "s-bot", name: "Петя из бота", role: "USER", email: null, phone: null, hasTelegram: true, createdAt: "" },
              ],
            },
          ],
        };
      }
      if (url.startsWith("/api/users/merge/search")) {
        return { success: true, data: [{ id: "u-3", name: "Пётр Второй", role: "USER", email: "p2@x.ru", phone: null, hasTelegram: false }] };
      }
      if (url === "/api/users/merge/preview") return { success: true, data: preview(MGR, BOT) };
      return { success: false, error: { message: "нет" } };
    });

    render(<MergeWizard open initialUserId="p-mgr" onClose={vi.fn()} onMerged={vi.fn()} />);

    const dupes = await screen.findByTestId("merge-duplicates");
    expect(dupes.textContent).toContain("Петя из бота");
    expect(dupes.textContent).toContain("Telegram уже привязан к другому аккаунту");

    fireEvent.change(screen.getByLabelText("Поиск аккаунта"), { target: { value: "пётр" } });
    const results = await screen.findByTestId("merge-search-results", {}, { timeout: 2000 });
    expect(results.textContent).toContain("Пётр Второй");
    const searchCall = fetchMock.mock.calls.find(([u]) => u.startsWith("/api/users/merge/search"))!;
    expect(searchCall[0]).toContain("exclude=p-mgr");

    fireEvent.click(screen.getByRole("button", { name: /Петя из бота/ }));
    await screen.findAllByRole("radio");
    const previewCall = fetchMock.mock.calls.find(([u]) => u === "/api/users/merge/preview")!;
    expect(body(previewCall[1])).toEqual({ primaryId: "p-mgr", secondaryId: "s-bot" });
  });
});
