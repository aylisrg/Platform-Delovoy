// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TelephonyDailySummary } from "@/modules/telephony/daily-summary-types";
import { TelephonyDailySummaryCard } from "../telephony-daily-summary-card";

const summary: TelephonyDailySummary = {
  reportDate: "2026-10-23",
  timeZone: "Europe/Moscow",
  generatedAt: "2026-10-24T06:00:00.000Z",
  total: 18, inbound: 14, answered: 10, missed: 3, outbound: 4, pending: 1,
  answerRate: 76.9,
};

afterEach(cleanup);

describe("TelephonyDailySummaryCard", () => {
  it("shows the report date and three separate metrics with inbound semantics", () => {
    render(<TelephonyDailySummaryCard summary={summary} unread onRead={vi.fn()} />);
    expect(screen.getByRole("article", { name: "Звонки за день" })).toBeTruthy();
    expect(screen.getByText("23-10-2026").getAttribute("dateTime")).toBe("2026-10-23");
    for (const [label, count] of [["Всего", "18"], ["Принято", "10"], ["Пропущено", "3"]]) {
      expect(screen.getByText(label).parentElement?.querySelector("dd")?.textContent).toBe(count);
    }
    expect(screen.getByText("Принято и пропущено — только входящие.")).toBeTruthy();
    expect(screen.getByText("У 1 входящих результат уточняется.")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Не прочитано" })).toBeTruthy();
  });

  it("expands in place, marks unread content read and shows the snapshot preparation time", () => {
    const onRead = vi.fn();
    const view = render(<TelephonyDailySummaryCard summary={summary} unread onRead={onRead} />);
    const button = screen.getByRole("button", { name: "Подробнее о звонках за 23-10-2026" });
    const details = document.getElementById(button.getAttribute("aria-controls")!);
    expect(details?.hidden).toBe(true);
    fireEvent.click(button);
    expect(details?.hidden).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(onRead).toHaveBeenCalledOnce();
    expect(screen.getByText("24-10-2026 09:00 МСК").getAttribute("dateTime")).toBe(summary.generatedAt);
    expect(screen.getByText("76,9%")).toBeTruthy();
    expect(screen.getByText(/Последующие перезвоны/)).toBeTruthy();
    expect(document.querySelector("a")).toBeNull();
    view.rerender(<TelephonyDailySummaryCard summary={summary} unread={false} onRead={onRead} />);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onRead).toHaveBeenCalledOnce();
    expect(screen.queryByRole("img", { name: "Не прочитано" })).toBeNull();
  });

  it("shows a truthful empty report and no invented response percentage", () => {
    const empty = { ...summary, total: 0, inbound: 0, answered: 0, missed: 0, outbound: 0, pending: 0, answerRate: null };
    render(<TelephonyDailySummaryCard summary={empty} unread={false} onRead={vi.fn()} />);
    expect(screen.getByText("За этот день в журнале нет звонков.")).toBeTruthy();
    expect(screen.queryByText("Есть пропущенные обращения")).toBeNull();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Доля принятых").parentElement?.querySelector("dd")?.textContent).toBe("—");
  });

  it("does not imply all calls were answered while inbound results are pending", () => {
    render(<TelephonyDailySummaryCard summary={{ ...summary, missed: 0, pending: 4 }} unread={false} onRead={vi.fn()} />);
    expect(screen.getByText("У 4 входящих результат уточняется.")).toBeTruthy();
    expect(screen.queryByText("Пропущенных входящих в журнале нет.")).toBeNull();
    expect(screen.queryByText(/Все звонки приняты/)).toBeNull();
  });
});
