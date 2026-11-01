// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DeleteBlockedDialog, DELETE_BLOCKED_TEXTS } from "../delete-blocked-dialog";

/** PRD 2026-10-25 US-A3 — «Удалить нельзя: у аккаунта есть история». */

const blockers = [
  { type: "AuditLog", label: "Журнал действий", count: 214 },
  { type: "ModuleAssignment", label: "Назначения на модули", count: 5 },
  { type: "Chat", label: "Чаты и сообщения", count: 17 },
];

afterEach(() => cleanup());

describe("DeleteBlockedDialog", () => {
  it("AC-A3.1: shows the title and every blocker as «label — count»", () => {
    render(
      <DeleteBlockedDialog userName="Иван" blockers={blockers} isTeamMember onClose={vi.fn()} onExclude={vi.fn()} />,
    );

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(DELETE_BLOCKED_TEXTS.title)).toBeTruthy();
    expect(screen.getByText("Журнал действий — 214")).toBeTruthy();
    expect(screen.getByText("Назначения на модули — 5")).toBeTruthy();
    expect(screen.getByText("Чаты и сообщения — 17")).toBeTruthy();
  });

  it("AC-A3.4: no internal type codes in the window", () => {
    const { container } = render(
      <DeleteBlockedDialog userName="Иван" blockers={blockers} isTeamMember onClose={vi.fn()} onExclude={vi.fn()} />,
    );
    expect(container.textContent).not.toMatch(/AuditLog|ModuleAssignment|USER_HAS_HISTORY/);
  });

  it("AC-A3.3: a team member gets «Исключить из команды» as the main action", () => {
    const onExclude = vi.fn();
    const onClose = vi.fn();
    render(
      <DeleteBlockedDialog userName="Иван" blockers={blockers} isTeamMember onClose={onClose} onExclude={onExclude} />,
    );

    expect(screen.getByText(DELETE_BLOCKED_TEXTS.team)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Исключить из команды" }));
    expect(onExclude).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("AC-A3.3: a client gets only the explanation and «Закрыть»", () => {
    const onClose = vi.fn();
    render(
      <DeleteBlockedDialog userName="Клиент" blockers={blockers} isTeamMember={false} onClose={onClose} onExclude={vi.fn()} />,
    );

    expect(screen.getByText("Аккаунты с историей не удаляются. Жёсткое удаление не поддерживается.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Исключить из команды" })).toBeNull();
    const closeButtons = screen.getAllByRole("button", { name: "Закрыть" });
    fireEvent.click(closeButtons[closeButtons.length - 1]);
    expect(onClose).toHaveBeenCalled();
  });

  it("AC-A3.2: unknown cause → general text, exclusion still offered to a team member", () => {
    render(<DeleteBlockedDialog userName="Иван" blockers={[]} isTeamMember onClose={vi.fn()} onExclude={vi.fn()} />);

    expect(screen.getByText(DELETE_BLOCKED_TEXTS.unknown)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Исключить из команды" })).toBeTruthy();
  });
});
