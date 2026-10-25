import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Реестр блокеров удаления — ADR 2026-10-25-team-access-notifications §5.1/§10,
 * PRD US-A3 (AC-A3.1/AC-A3.2).
 */

const { mockPrisma } = vi.hoisted(() => {
  const counter = () => ({ count: vi.fn().mockResolvedValue(0) });
  return {
    mockPrisma: {
      auditLog: counter(),
      moduleAssignment: counter(),
      taskAssignee: counter(),
      feedbackItem: counter(),
      subscription: counter(),
      chat: counter(),
      chatParticipant: counter(),
      chatMessage: counter(),
      chatMessageReceipt: counter(),
      mergeCandidate: counter(),
      outgoingNotification: counter(),
    },
  };
});

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

import {
  DELETION_BLOCKERS,
  SHELL_IGNORED_BLOCKERS,
  getDeletionBlockers,
} from "@/modules/users/deletion-blockers";

beforeEach(() => {
  vi.clearAllMocks();
  for (const model of Object.values(mockPrisma)) model.count.mockResolvedValue(0);
});

describe("getDeletionBlockers", () => {
  it("AC-A3.1: Russian labels with counts, in registry order", async () => {
    mockPrisma.auditLog.count.mockResolvedValue(214);
    mockPrisma.moduleAssignment.count.mockResolvedValue(5);
    mockPrisma.taskAssignee.count.mockResolvedValue(3);
    mockPrisma.feedbackItem.count.mockResolvedValue(1);
    mockPrisma.subscription.count.mockResolvedValue(2);
    mockPrisma.chat.count.mockResolvedValue(1);
    mockPrisma.chatParticipant.count.mockResolvedValue(2);
    mockPrisma.chatMessage.count.mockResolvedValue(10);
    mockPrisma.chatMessageReceipt.count.mockResolvedValue(4);
    mockPrisma.outgoingNotification.count.mockResolvedValue(40);

    const blockers = await getDeletionBlockers("u-1");

    expect(blockers).toEqual([
      { type: "AuditLog", label: "Журнал действий", count: 214 },
      { type: "ModuleAssignment", label: "Назначения на модули", count: 5 },
      { type: "TaskAssignee", label: "Задачи", count: 3 },
      { type: "FeedbackItem", label: "Обратная связь", count: 1 },
      { type: "Subscription", label: "Абонементы Плей Парка", count: 2 },
      // Chat + participant + message + receipt → one line (sum).
      { type: "Chat", label: "Чаты и сообщения", count: 17 },
      { type: "OutgoingNotification", label: "Доставленные уведомления", count: 40 },
    ]);
  });

  it("AC-A3.2: types without rows are hidden", async () => {
    mockPrisma.subscription.count.mockResolvedValue(1);
    expect(await getDeletionBlockers("u-1")).toEqual([
      { type: "Subscription", label: "Абонементы Плей Парка", count: 1 },
    ]);
    mockPrisma.subscription.count.mockResolvedValue(0);
    expect(await getDeletionBlockers("u-1")).toEqual([]);
  });

  it("AC-A3.2: every number is a verifiable query on the user's rows (incl. indirect notifications)", async () => {
    await getDeletionBlockers("u-1");

    expect(mockPrisma.auditLog.count).toHaveBeenCalledWith({ where: { userId: "u-1" } });
    expect(mockPrisma.moduleAssignment.count).toHaveBeenCalledWith({ where: { userId: "u-1" } });
    expect(mockPrisma.taskAssignee.count).toHaveBeenCalledWith({ where: { userId: "u-1" } });
    expect(mockPrisma.feedbackItem.count).toHaveBeenCalledWith({ where: { userId: "u-1" } });
    expect(mockPrisma.subscription.count).toHaveBeenCalledWith({ where: { userId: "u-1" } });
    expect(mockPrisma.chat.count).toHaveBeenCalledWith({ where: { createdByUserId: "u-1" } });
    expect(mockPrisma.chatParticipant.count).toHaveBeenCalledWith({ where: { userId: "u-1" } });
    expect(mockPrisma.chatMessage.count).toHaveBeenCalledWith({ where: { senderUserId: "u-1" } });
    expect(mockPrisma.chatMessageReceipt.count).toHaveBeenCalledWith({ where: { userId: "u-1" } });
    expect(mockPrisma.mergeCandidate.count).toHaveBeenCalledWith({
      where: { OR: [{ primaryUserId: "u-1" }, { candidateUserId: "u-1" }] },
    });
    // OutgoingNotification blocks through the user's (cascading) channels.
    expect(mockPrisma.outgoingNotification.count).toHaveBeenCalledWith({
      where: { channel: { userId: "u-1" } },
    });
  });

  it("uses the transaction client when one is given", async () => {
    const tx = { auditLog: { count: vi.fn().mockResolvedValue(1) } };
    const other = Object.fromEntries(
      Object.entries(mockPrisma)
        .filter(([key]) => key !== "auditLog")
        .map(([key]) => [key, { count: vi.fn().mockResolvedValue(0) }]),
    );
    const blockers = await getDeletionBlockers("u-1", { ...other, ...tx } as never);
    expect(blockers).toEqual([{ type: "AuditLog", label: "Журнал действий", count: 1 }]);
    expect(mockPrisma.auditLog.count).not.toHaveBeenCalled();
  });

  it("SHELL_IGNORED_BLOCKERS: journal, notifications and merge candidates are «служебные»", () => {
    expect([...SHELL_IGNORED_BLOCKERS].sort()).toEqual(["AuditLog", "MergeCandidate", "OutgoingNotification"]);
    for (const type of SHELL_IGNORED_BLOCKERS) {
      expect(DELETION_BLOCKERS.some((b) => b.type === type)).toBe(true);
    }
  });

  it("labels carry no technical codes (AC-A3.4)", () => {
    for (const blocker of DELETION_BLOCKERS) {
      expect(blocker.label).toMatch(/^[А-ЯЁ][А-Яа-яЁё ]+$/);
    }
  });
});

// ─── Registry coverage of RESTRICT / NO ACTION FKs to "User" ────────────────

type ForeignKey = { table: string; constraint: string; column: string; onDelete: string };

/**
 * Replays every migration in order: `ADD CONSTRAINT … FOREIGN KEY … REFERENCES
 * "User"` defines/overrides a constraint by name, `DROP CONSTRAINT` removes it.
 * The last definition per constraint name wins. Missing ON DELETE = NO ACTION.
 */
function collectUserForeignKeys(sqlFiles: string[]): Map<string, ForeignKey> {
  const fks = new Map<string, ForeignKey>();
  const statement =
    /(?:ALTER TABLE (?:IF EXISTS )?(?:ONLY )?"?(\w+)"? DROP CONSTRAINT (?:IF EXISTS )?"?(\w+)"?)|(?:CONSTRAINT "?(\w+)"? FOREIGN KEY \(\s*"?(\w+)"?\s*\) REFERENCES "?(\w+)"? ?\(\s*"?(\w+)"?\s*\)((?: ON (?:DELETE|UPDATE) (?:RESTRICT|CASCADE|SET NULL|SET DEFAULT|NO ACTION))*))/gi;
  const tableBefore = (sql: string, index: number): string => {
    const head = sql.slice(0, index);
    const matches = [...head.matchAll(/(?:ALTER|CREATE) TABLE (?:IF (?:NOT )?EXISTS )?(?:ONLY )?"?(\w+)"?/gi)];
    return matches.length > 0 ? matches[matches.length - 1][1] : "?";
  };

  for (const raw of sqlFiles) {
    const sql = raw.replace(/--[^\n]*/g, " ").replace(/\s+/g, " ");
    for (const match of sql.matchAll(statement)) {
      if (match[2]) {
        fks.delete(match[2]);
        continue;
      }
      const [, , , constraint, column, referenced, referencedColumn, actions = ""] = match;
      if (referenced !== "User" || referencedColumn !== "id") {
        // Same name re-pointed elsewhere → it no longer references User.
        fks.delete(constraint);
        continue;
      }
      const onDelete = /ON DELETE (RESTRICT|CASCADE|SET NULL|SET DEFAULT|NO ACTION)/i.exec(actions)?.[1] ?? "NO ACTION";
      fks.set(constraint, {
        table: tableBefore(sql, match.index ?? 0),
        constraint,
        column,
        onDelete: onDelete.toUpperCase(),
      });
    }
  }
  return fks;
}

function readMigrations(): string[] {
  const dir = path.resolve(__dirname, "../../../../prisma/migrations");
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => path.join(dir, name, "migration.sql"))
    .filter((file) => fs.existsSync(file))
    .map((file) => fs.readFileSync(file, "utf8"));
}

const blocking = (fk: ForeignKey) => fk.onDelete === "RESTRICT" || fk.onDelete === "NO ACTION";

describe("DELETION_BLOCKERS covers every RESTRICT/NO ACTION FK on \"User\"", () => {
  const fks = collectUserForeignKeys(readMigrations());

  it("parser sanity: sees the real FKs with their latest ON DELETE rule", () => {
    expect(fks.get("AuditLog_userId_fkey")).toMatchObject({ table: "AuditLog", onDelete: "RESTRICT" });
    // Re-created as SET NULL by later migrations — the latest definition wins.
    expect(fks.get("Booking_userId_fkey")).toMatchObject({ table: "Booking", onDelete: "SET NULL" });
    expect(fks.get("Order_userId_fkey")).toMatchObject({ table: "Order", onDelete: "SET NULL" });
    // NO ACTION → RESTRICT in the reconcile migration; multi-line DO $$ blocks are parsed.
    expect(fks.get("Subscription_userId_fkey")).toMatchObject({ table: "Subscription", onDelete: "RESTRICT" });
    expect(fks.get("MergeCandidate_candidateUserId_fkey")).toMatchObject({ table: "MergeCandidate" });
    expect(fks.get("ModuleNotificationRecipient_userId_fkey")).toMatchObject({ onDelete: "CASCADE" });
    expect([...fks.values()].filter(blocking).length).toBeGreaterThanOrEqual(10);
  });

  it("parser: a new uncovered RESTRICT FK would be reported", () => {
    const extra = collectUserForeignKeys([
      'ALTER TABLE "Widget" ADD CONSTRAINT "Widget_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON UPDATE CASCADE;',
      'ALTER TABLE "Gone" ADD CONSTRAINT "Gone_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT;\nALTER TABLE "Gone" DROP CONSTRAINT "Gone_userId_fkey";',
    ]);
    expect(extra.get("Widget_ownerId_fkey")).toMatchObject({ table: "Widget", onDelete: "NO ACTION" });
    expect(extra.has("Gone_userId_fkey")).toBe(false);
  });

  it("AC-A3.2: every blocking FK table is listed in some registry entry", () => {
    const covered = new Set(DELETION_BLOCKERS.flatMap((b) => b.tables));
    const uncovered = [...fks.values()]
      .filter(blocking)
      .filter((fk) => !covered.has(fk.table))
      .map((fk) => `${fk.table}.${fk.column} (${fk.constraint}, ON DELETE ${fk.onDelete})`);
    expect(uncovered).toEqual([]);
  });
});
