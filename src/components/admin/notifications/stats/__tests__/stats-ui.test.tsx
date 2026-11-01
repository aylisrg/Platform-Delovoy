// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

/**
 * Statistics UI — PRD US-D1/D2/D4, ADR 2026-10-25 §7 «Статистика (D1/D4)».
 */

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { StatsPage, buildStatsQuery } from "../stats-page";
import { UserStatsBlock } from "@/components/admin/users/profile/stats-block";
import {
  TELEGRAM_READ_CAPTION,
  formatDuration,
  formatPercent,
  measuredSinceText,
  plural,
  reactionText,
} from "../format";
import { sortBreakdownRows, type BreakdownRow } from "../breakdown-table";
import type { NotificationMetrics, NotificationStats, UserNotificationStats } from "@/modules/notifications/types";

const QA_D: NotificationMetrics = {
  sent: 13,
  delivered: 11,
  failed: 2,
  inFlight: 0,
  read: 2,
  clickedNotifications: 5,
  clicksTotal: 6,
  measurable: 9,
  unmeasurable: 2,
  reactions: 6,
  reactionRate: 6 / 9,
  medianReactionSeconds: 510,
  noReaction24hShare: 3 / 9,
};

const ZERO: NotificationMetrics = {
  sent: 0, delivered: 0, failed: 0, inFlight: 0, read: 0, clickedNotifications: 0, clicksTotal: 0, measurable: 0,
  unmeasurable: 0, reactions: 0, reactionRate: null, medianReactionSeconds: null, noReaction24hShare: null,
};

const period = { days: 30 as const, from: "2026-09-25T10:00:00.000Z", to: "2026-10-25T10:00:00.000Z" };

const GENERAL: NotificationStats = {
  period,
  measuredSince: { clicks: "2026-10-25T06:00:00.000Z", partial: true },
  totals: QA_D,
  byEvent: [
    { eventType: "booking.created", label: "Новая бронь", categoryKey: "bookings", ...QA_D },
    { eventType: "order.placed", label: "Новый заказ", categoryKey: "cafe", ...ZERO },
  ],
  byUser: [
    { user: { id: "u_a", name: "Анна", role: "MANAGER" }, ...QA_D },
    { user: { id: "u_b", name: "Борис", role: "MANAGER" }, ...ZERO },
  ],
  byChannel: [
    { channel: "TELEGRAM", ...ZERO, sent: 8, delivered: 6, failed: 2 },
    { channel: "PUSH", ...ZERO, sent: 2, delivered: 2 },
    { channel: "EMAIL", ...ZERO },
    { channel: "IN_APP", ...ZERO, sent: 3, delivered: 3, read: 2 },
  ],
  skips: { total: 3, byReason: [{ reason: "NO_CHANNEL", label: "Нет канала", count: 3 }] },
  groupChats: { sent: 3, failed: 1 },
  problems: {
    botNotStarted: { users: 1, failedDeliveries: 1, userIds: ["u_b"] },
    botBlocked: { users: 1, failedDeliveries: 1, userIds: ["u_a"] },
    noWorkingChannel: { users: 1, userIds: ["u_b"] },
    eventsWithoutPersonalRecipients: { count: 1, eventTypes: ["order.placed"] },
  },
};

const USER: UserNotificationStats = {
  period,
  measuredSince: { clicks: "2026-01-01T00:00:00.000Z", partial: false },
  totals: QA_D,
  byEvent: [
    { eventType: "booking.created", label: "Новая бронь", categoryKey: "bookings", ...QA_D },
    { eventType: "order.cancelled", label: "Отмена заказа", categoryKey: "cafe", ...ZERO },
  ],
  byChannel: [
    { channel: "TELEGRAM", ...ZERO, sent: 8, delivered: 6, failed: 2 },
    { channel: "EMAIL", ...ZERO },
  ],
  skips: { total: 0, byReason: [] },
  recent: [
    { at: "2026-10-24T10:00:00.000Z", eventType: "order.placed", eventLabel: "Новый заказ", channel: "TELEGRAM", status: "FAILED", statusLabel: "Ошибка: бот заблокирован", measurable: false, reaction: null },
    { at: "2026-10-23T10:00:00.000Z", eventType: "telephony.daily_summary", eventLabel: "Ежедневная сводка звонков", channel: "IN_APP", status: "DELIVERED", statusLabel: "Доставлено", measurable: true, reaction: { kind: "read", afterSeconds: 180 } },
    { at: "2026-10-22T10:00:00.000Z", eventType: "booking.created", eventLabel: "Новая бронь", channel: "TELEGRAM", status: "DELIVERED", statusLabel: "Доставлено", measurable: true, reaction: { kind: "click", afterSeconds: 720 } },
    { at: "2026-10-21T10:00:00.000Z", eventType: "contract.expiring", eventLabel: "Договор истекает", channel: "TELEGRAM", status: "DELIVERED", statusLabel: "Доставлено", measurable: true, reaction: null },
    { at: "2026-10-20T10:00:00.000Z", eventType: "system.release", eventLabel: "Релизы платформы", channel: "TELEGRAM", status: "DELIVERED", statusLabel: "Доставлено", measurable: false, reaction: null },
  ],
  problems: { botNotStarted: false, botBlocked: true, failedByBot: 2, failedBotNotStarted: 1, failedBotBlocked: 1 },
};

let fetchMock: ReturnType<typeof vi.fn>;

function mockFetch(body: unknown) {
  fetchMock = vi.fn(() => Promise.resolve({ json: () => Promise.resolve(body) }));
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  mockFetch({ success: true, data: GENERAL });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("format helpers", () => {
  it("plural / percent / duration", () => {
    expect([1, 2, 5, 11, 21, 22, 25].map((n) => plural(n, ["сотрудник", "сотрудника", "сотрудников"]))).toEqual([
      "сотрудник", "сотрудника", "сотрудников", "сотрудников", "сотрудник", "сотрудника", "сотрудников",
    ]);
    expect(formatPercent(6 / 9)).toBe("67%");
    expect(formatPercent(null)).toBe("—");
    expect(formatDuration(45)).toBe("45 с");
    expect(formatDuration(180)).toBe("3 мин");
    expect(formatDuration(3900)).toBe("1 ч 5 мин");
    expect(formatDuration(90000)).toBe("1 дн 1 ч");
    expect(formatDuration(null)).toBe("—");
  });

  it("AC-D2.2: reaction texts", () => {
    expect(reactionText({ status: "DELIVERED", measurable: true, reaction: { kind: "read", afterSeconds: 180 } })).toBe("Прочитано через 3 мин");
    expect(reactionText({ status: "DELIVERED", measurable: true, reaction: { kind: "click", afterSeconds: 720 } })).toBe("Клик через 12 мин");
    expect(reactionText({ status: "DELIVERED", measurable: true, reaction: null })).toBe("Нет реакции");
    expect(reactionText({ status: "DELIVERED", measurable: false, reaction: null })).toBe("Реакцию измерить нельзя");
    expect(reactionText({ status: "FAILED", measurable: false, reaction: null })).toBe("—");
  });

  it("AC-D1.8: «Клики измеряются с <дата>» only when the period is partial", () => {
    expect(measuredSinceText({ clicks: "2026-10-25T06:00:00.000Z", partial: true })).toBe(
      "Клики измеряются с 25.10.2026; за более ранние дни данных нет.",
    );
    expect(measuredSinceText({ clicks: "2026-01-01T00:00:00.000Z", partial: false })).toBeNull();
  });

  it("sorting keeps «—» (null) last in both directions", () => {
    const rows: BreakdownRow[] = [
      { key: "a", label: "a", sortLabel: "a", metrics: { ...ZERO, reactionRate: 0.5 } },
      { key: "b", label: "b", sortLabel: "b", metrics: { ...ZERO, reactionRate: null } },
      { key: "c", label: "c", sortLabel: "c", metrics: { ...ZERO, reactionRate: 0.9 } },
    ];
    expect(sortBreakdownRows(rows, "reactionRate", "desc").map((r) => r.key)).toEqual(["c", "a", "b"]);
    expect(sortBreakdownRows(rows, "reactionRate", "asc").map((r) => r.key)).toEqual(["a", "c", "b"]);
  });
});

describe("StatsPage (US-D1)", () => {
  it("AC-D1.1: loads 30 days by default; period and filters go to the query", async () => {
    render(<StatsPage />);
    await screen.findByText("По сотрудникам");
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/notifications/stats?period=30");

    fireEvent.click(screen.getByRole("button", { name: "90 дней" }));
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith("/api/admin/notifications/stats?period=90"));

    fireEvent.change(screen.getByLabelText("Канал"), { target: { value: "TELEGRAM" } });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith("/api/admin/notifications/stats?period=90&channel=TELEGRAM"),
    );
    expect(buildStatsQuery(7, { category: "cafe", eventType: "order.placed", channel: "", userId: "u_a" })).toBe(
      "period=7&category=cafe&eventType=order.placed&userId=u_a",
    );
  });

  it("AC-D1.2/AC-D1.4/AC-D1.8: cards, the Telegram caption next to «Прочитано», partial note", async () => {
    render(<StatsPage />);
    const cards = await screen.findByTestId("metric-cards");
    expect(within(cards).getByText("13")).toBeTruthy();
    expect(within(cards).getByText("67%")).toBeTruthy();
    expect(within(cards).getByText("9 мин")).toBeTruthy(); // median 510 s
    expect(within(cards).getByText(TELEGRAM_READ_CAPTION)).toBeTruthy();
    // The caption repeats on the Telegram channel row (AC-D1.4).
    expect(screen.getAllByText(TELEGRAM_READ_CAPTION)).toHaveLength(2);
    expect(screen.getByRole("note").textContent).toBe("Клики измеряются с 25.10.2026; за более ранние дни данных нет.");
  });

  it("AC-D1.2: «i» shows the glossary definition", async () => {
    render(<StatsPage />);
    await screen.findByTestId("metric-cards");
    fireEvent.click(screen.getByRole("button", { name: "Что значит «Доля реакции»" }));
    expect(screen.getByRole("tooltip").textContent).toContain("уведомления с реакцией / измеримые доставленные");
  });

  it("AC-D1.5: a separate «Групповые чаты» row with sent/failed only", async () => {
    render(<StatsPage />);
    const row = (await screen.findByText("Групповые чаты")).closest("tr") as HTMLTableRowElement;
    const cells = within(row).getAllByRole("cell").map((c) => c.textContent);
    expect(cells[1]).toBe("3"); // sent
    expect(cells[3]).toBe("1"); // failed
    expect(cells.slice(4)).toEqual(["—", "—", "—", "—", "—", "—"]);
  });

  it("AC-D4.1/AC-D4.2: problems with counts and links to the staff pages", async () => {
    render(<StatsPage />);
    const block = (await screen.findByText("Проблемы")).closest("section") as HTMLElement;
    expect(block.textContent).toContain("Бот не запущен — 1 сотрудник, 1 неудачная доставка за 30 дней");
    expect(block.textContent).toContain("Бот заблокирован — 1 сотрудник, 1 неудачная доставка за 30 дней");
    expect(block.textContent).toContain("Подписаны, но нет рабочего канала — 1 сотрудник");
    expect(block.textContent).toContain("События, которых лично не получает никто — 1");
    const links = within(block).getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(links).toEqual(["/admin/users/u_b", "/admin/users/u_a", "/admin/users/u_b", "/admin/notifications/matrix"]);
  });

  it("AC-D1.3: employee table is sortable; clicking a name filters by that employee", async () => {
    render(<StatsPage />);
    const table = (await screen.findByText("По сотрудникам")).closest("section") as HTMLElement;
    const names = () => within(table).getAllByRole("row").slice(1).map((r) => r.querySelector("td button")?.textContent);
    fireEvent.click(within(table).getByRole("button", { name: "Отправлено" }));
    expect(names()[0]).toContain("Анна");
    fireEvent.click(within(table).getByRole("button", { name: /Отправлено/ }));
    expect(names()[0]).toContain("Борис");

    fireEvent.click(within(table).getByRole("button", { name: /Борис/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith("/api/admin/notifications/stats?period=30&userId=u_b"));
  });

  it("shows the API error message", async () => {
    mockFetch({ success: false, error: { code: "FORBIDDEN", message: "Доступ запрещён" } });
    render(<StatsPage />);
    expect((await screen.findByRole("alert")).textContent).toBe("Доступ запрещён");
  });
});

describe("UserStatsBlock (US-D2)", () => {
  beforeEach(() => {
    mockFetch({ success: true, data: USER });
  });

  it("AC-D2.1: fetches the employee's stats for 30 days by default, then the chosen period", async () => {
    render(<UserStatsBlock userId="u_a" />);
    await screen.findByText("Последние уведомления");
    expect(fetchMock).toHaveBeenCalledWith("/api/users/u_a/notification-stats?period=30");
    fireEvent.click(screen.getByRole("button", { name: "7 дней" }));
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith("/api/users/u_a/notification-stats?period=7"));
  });

  it("AC-D2.2/AC-D2.3: recent list with human statuses and reactions, no message text", async () => {
    render(<UserStatsBlock userId="u_a" />);
    const recent = (await screen.findByText("Последние уведомления")).closest("section") as HTMLElement;
    const rows = within(recent).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell").map((c) => c.textContent));
    expect(rows.map((r) => [r[1], r[2], r[3], r[4]])).toEqual([
      ["Новый заказ", "Telegram", "Ошибка: бот заблокирован", "—"],
      ["Ежедневная сводка звонков", "Лента Mini App", "Доставлено", "Прочитано через 3 мин"],
      ["Новая бронь", "Telegram", "Доставлено", "Клик через 12 мин"],
      ["Договор истекает", "Telegram", "Доставлено", "Нет реакции"],
      ["Релизы платформы", "Telegram", "Доставлено", "Реакцию измерить нельзя"],
    ]);
    expect(screen.queryByText(/BOT_BLOCKED/)).toBeNull();
  });

  it("AC-D2.1: by event / by channel show only what happened; Telegram caption kept", async () => {
    render(<UserStatsBlock userId="u_a" />);
    await screen.findByText("Последние уведомления");
    expect(screen.queryByText("Отмена заказа")).toBeNull();
    expect(screen.queryByText("Email")).toBeNull();
    expect(screen.getAllByText(TELEGRAM_READ_CAPTION).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole("note")).toBeNull(); // not partial
  });

  it("AC-D4.1: the employee's bot problems", async () => {
    render(<UserStatsBlock userId="u_a" />);
    const block = await screen.findByRole("region", { name: "Проблемы доставки" });
    expect(block.textContent).toContain("Бот не запущен — 1 неудачная доставка за 30 дней");
    expect(block.textContent).toContain("Бот заблокирован — 1 неудачная доставка за 30 дней · сейчас бот заблокирован");
  });
});
