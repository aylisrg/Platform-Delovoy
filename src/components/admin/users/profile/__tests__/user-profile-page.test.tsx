// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const replace = vi.fn();
const params = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  useSearchParams: () => params,
}));
vi.mock("../notifications-block", () => ({ NotificationsBlock: () => <div>notifications-block</div> }));

import { UserProfilePage } from "../user-profile-page";

const overview = {
  kind: "user",
  user: {
    id: "u1", name: "Иван", image: null, role: "USER", createdAt: "2026-01-01T00:00:00.000Z", source: "telegram_bot",
    sourceLabel: "Telegram-бот", lastLoginAt: null, isTeamMember: false, isSeededSuperadmin: false,
  },
  contacts: {
    email: null, emailVerified: false, phone: null, telegramLinked: true, vkLinked: false, authMethods: ["telegram"],
    botStatus: { state: "BLOCKED", blockedAt: "2026-10-20T00:00:00.000Z" },
  },
  access: { sections: [], strictSections: [{ slug: "nedelovoy", label: "НеДеловой", granted: false }], modules: [], recipientLists: [] },
  actions: { canExclude: false, canMerge: true, canResetPassword: false, canChangeRole: true, canDelete: true },
  possibleDuplicates: [{ userId: "u2", name: "Иван (email)", role: "MANAGER", reason: "merge_request", mergeRequestId: "mr1" }],
};

function respond(data: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ success: true, data }) }) as Response));
}

beforeEach(() => replace.mockReset());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("UserProfilePage (US-B1)", () => {
  it("AC-B1.1: a merged account redirects to the primary", async () => {
    respond({ kind: "merged", primaryUserId: "p1" });
    render(<UserProfilePage userId="u1" />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/admin/users/p1?mergedFrom=1"));
  });

  it("AC-B1.3/B1.7: USER banner + client card link, explicit «not set», bot state, duplicates; no exclude button", async () => {
    respond(overview);
    render(<UserProfilePage userId="u1" />);
    expect(await screen.findByText(/Не входит в команду/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Карточка клиента" }).getAttribute("href")).toBe("/admin/clients/u1");
    expect(screen.getByText("Email не указан")).toBeTruthy();
    expect(screen.getByText("Бот заблокирован")).toBeTruthy();
    expect(screen.getByText(/запрос на объединение/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Исключить из команды" })).toBeNull();
    expect(screen.getByText("notifications-block")).toBeTruthy();
  });

  it("not found → message with a way back", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ success: false, error: { message: "Пользователь не найден" } }) }) as Response));
    render(<UserProfilePage userId="x" />);
    expect(await screen.findByText(/Пользователь не найден/)).toBeTruthy();
  });
});
