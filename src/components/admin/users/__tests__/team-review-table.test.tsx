// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TeamReviewTable } from "../team-review-table";

const row = {
  id: "m1",
  name: "Борис",
  image: null,
  role: "MANAGER",
  email: "b@x.ru",
  emailVerified: false,
  hasTelegram: true,
  botStatus: { state: "NOT_STARTED", trackingSince: null },
  sections: [{ slug: "cafe", label: "Кафе", source: "grant" }],
  modules: [{ slug: "cafe", name: "Кафе" }],
  subscriptions: { active: 2, available: 5 },
  releases: false,
  lastLoginAt: null,
  flags: ["BOT_NOT_STARTED", "STALE_LOGIN"],
  isSeededSuperadmin: false,
};

function respond(body: unknown) {
  return { ok: true, json: async () => body } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).startsWith("/api/users/team")) return respond({ success: true, data: { rows: [row], pendingMergeRequests: 1 } });
    return respond({ success: true, data: {} });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TeamReviewTable (US-B2)", () => {
  it("AC-B2.1/B2.2/B2.3: link to the staff page, bot status, «N из M», flags, merge-request counter", async () => {
    render(<TeamReviewTable />);
    const link = await screen.findByRole("link", { name: "Борис" });
    expect(link.getAttribute("href")).toBe("/admin/users/m1");
    expect(screen.getAllByText("Бот не запущен").length).toBeGreaterThan(0);
    expect(screen.getByText("2 из 5")).toBeTruthy();
    expect(screen.getByText("Давно не заходил")).toBeTruthy();
    expect(screen.getByText(/Запросы на объединение: 1/)).toBeTruthy();
  });

  it("AC-B2.4: filters go to the API", async () => {
    render(<TeamReviewTable />);
    await screen.findByRole("link", { name: "Борис" });
    fireEvent.click(screen.getByLabelText("Есть проблемы"));
    fireEvent.change(screen.getByLabelText("Статус бота"), { target: { value: "blocked" } });
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes("problems=true") && String(u).includes("bot=blocked"))).toBe(true),
    );
  });

  it("AC-B2.5/C2.8: «Релизы» toggles the same subscription endpoint", async () => {
    render(<TeamReviewTable />);
    fireEvent.click(await screen.findByRole("switch", { name: "Релизы: Борис" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/users/m1/notifications", expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ eventType: "system.release", enabled: true, source: "team" }),
      })),
    );
  });
});
