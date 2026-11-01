import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * isDisposableTelegramShell — ADR 2026-10-25 §Q9: only an account with nothing
 * to transfer may be folded into the email account by the self-link.
 */

const counts = vi.hoisted(() => ({
  auditLog: 0,
  moduleAssignment: 0,
  taskAssignee: 0,
  feedbackItem: 0,
  subscription: 0,
  chat: 0,
  chatParticipant: 0,
  chatMessage: 0,
  chatMessageReceipt: 0,
  mergeCandidate: 0,
  outgoingNotification: 0,
  booking: 0,
  order: 0,
  task: 0,
}));

const userRow = vi.hoisted(() => ({
  value: null as null | { role: string; mergedIntoUserId: string | null; email: string | null; passwordHash: string | null },
}));

vi.mock("@/lib/db", () => {
  const counter = (key: keyof typeof counts) => ({ count: vi.fn(async () => counts[key]) });
  return {
    prisma: {
      user: { findUnique: vi.fn(async () => userRow.value) },
      auditLog: counter("auditLog"),
      moduleAssignment: counter("moduleAssignment"),
      taskAssignee: counter("taskAssignee"),
      feedbackItem: counter("feedbackItem"),
      subscription: counter("subscription"),
      chat: counter("chat"),
      chatParticipant: counter("chatParticipant"),
      chatMessage: counter("chatMessage"),
      chatMessageReceipt: counter("chatMessageReceipt"),
      mergeCandidate: counter("mergeCandidate"),
      outgoingNotification: counter("outgoingNotification"),
      booking: counter("booking"),
      order: counter("order"),
      task: counter("task"),
    },
  };
});

import { isDisposableTelegramShell } from "../shell";

beforeEach(() => {
  for (const key of Object.keys(counts) as Array<keyof typeof counts>) counts[key] = 0;
  userRow.value = { role: "USER", mergedIntoUserId: null, email: null, passwordHash: null };
});

describe("isDisposableTelegramShell", () => {
  it("a fresh Mini App account (USER, no email/password, no history) is a shell", async () => {
    expect(await isDisposableTelegramShell("tg-1")).toBe(true);
  });

  it("«служебные» rows (journal, delivered notifications, merge candidates) don't count as history", async () => {
    counts.auditLog = 5;
    counts.outgoingNotification = 3;
    counts.mergeCandidate = 1;
    expect(await isDisposableTelegramShell("tg-1")).toBe(true);
  });

  it.each([
    ["missing", null],
    ["staff role", { role: "MANAGER", mergedIntoUserId: null, email: null, passwordHash: null }],
    ["merged", { role: "USER", mergedIntoUserId: "x", email: null, passwordHash: null }],
    ["has email", { role: "USER", mergedIntoUserId: null, email: "a@x.ru", passwordHash: null }],
    ["has password", { role: "USER", mergedIntoUserId: null, email: null, passwordHash: "h" }],
  ])("not a shell: %s", async (_label, row) => {
    userRow.value = row;
    expect(await isDisposableTelegramShell("tg-1")).toBe(false);
  });

  it.each([
    "taskAssignee",
    "feedbackItem",
    "subscription",
    "chatMessage",
    "moduleAssignment",
    "booking",
    "order",
    "task",
  ] as const)("not a shell with history: %s", async (key) => {
    counts[key] = 1;
    expect(await isDisposableTelegramShell("tg-1")).toBe(false);
  });

  it("uses the given transaction client", async () => {
    const tx = {
      user: { findUnique: vi.fn(async () => ({ role: "USER", mergedIntoUserId: null, email: "a@x.ru", passwordHash: null })) },
    };
    expect(await isDisposableTelegramShell("tg-1", tx as never)).toBe(false);
    expect(tx.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "tg-1" } }));
  });
});
