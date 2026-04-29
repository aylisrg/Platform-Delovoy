import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/db", () => ({
  prisma: {
    avitoMessage: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    avitoItem: {
      findUnique: vi.fn(),
    },
    task: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    taskColumn: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    taskBoard: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    taskCategory: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    taskComment: {
      create: vi.fn(),
    },
    taskEvent: {
      create: vi.fn(),
    },
    taskAssignee: {
      create: vi.fn(),
    },
  },
}));

const { routeInboundMessage, AVITO_LEAD_REOPEN_WINDOW_DAYS } = await import(
  "../lead-routing"
);
const { prisma } = await import("@/lib/db");

type MockFn = ReturnType<typeof vi.fn>;

const m = {
  avitoMessageCreate: prisma.avitoMessage.create as unknown as MockFn,
  avitoMessageFindUnique: prisma.avitoMessage.findUnique as unknown as MockFn,
  avitoMessageFindFirst: prisma.avitoMessage.findFirst as unknown as MockFn,
  avitoMessageUpdate: prisma.avitoMessage.update as unknown as MockFn,
  avitoItemFindUnique: prisma.avitoItem.findUnique as unknown as MockFn,
  taskFindUnique: prisma.task.findUnique as unknown as MockFn,
  taskFindFirst: prisma.task.findFirst as unknown as MockFn,
  taskCreate: prisma.task.create as unknown as MockFn,
  taskUpdate: prisma.task.update as unknown as MockFn,
  taskColumnFindFirst: prisma.taskColumn.findFirst as unknown as MockFn,
  taskColumnCreate: prisma.taskColumn.create as unknown as MockFn,
  taskBoardFindUnique: prisma.taskBoard.findUnique as unknown as MockFn,
  taskBoardFindFirst: prisma.taskBoard.findFirst as unknown as MockFn,
  taskBoardCreate: prisma.taskBoard.create as unknown as MockFn,
  taskCategoryFindUnique: prisma.taskCategory.findUnique as unknown as MockFn,
  taskCategoryCreate: prisma.taskCategory.create as unknown as MockFn,
  taskCommentCreate: prisma.taskComment.create as unknown as MockFn,
  taskEventCreate: prisma.taskEvent.create as unknown as MockFn,
  taskAssigneeCreate: prisma.taskAssignee.create as unknown as MockFn,
};

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  // Sensible default: comment + event + assignee creators succeed.
  m.taskCommentCreate.mockImplementation(async (args: { data: { taskId: string } }) => ({
    id: "comment-id",
    taskId: args.data.taskId,
    body: "",
    createdAt: new Date(),
  }));
  m.taskEventCreate.mockResolvedValue({ id: "event-id" });
  m.taskAssigneeCreate.mockResolvedValue({ id: "assignee-id" });
  m.avitoMessageUpdate.mockResolvedValue({ id: "msg-row" });
  m.taskUpdate.mockImplementation(async ({ where, data }: { where: { id: string }; data: unknown }) => ({
    id: where.id,
    ...(data as Record<string, unknown>),
  }));
});

const baseInput = {
  avitoMessageId: "msg-1",
  avitoChatId: "chat-1",
  avitoItemId: "9999",
  authorAvitoUserId: "buyer-1",
  authorName: "Иван",
  body: "Свободна ли беседка?",
  receivedAt: new Date("2026-04-28T10:00:00Z"),
  rawPayload: { raw: 1 },
};

it("export AVITO_LEAD_REOPEN_WINDOW_DAYS = 30", () => {
  expect(AVITO_LEAD_REOPEN_WINDOW_DAYS).toBe(30);
});

describe("routeInboundMessage — branch 1: open task exists", () => {
  it("appends a comment, no reopen, no autoReply", async () => {
    m.avitoMessageCreate.mockResolvedValueOnce({ id: "row-1" });
    m.avitoItemFindUnique.mockResolvedValueOnce({
      id: "item-db",
      moduleSlug: "gazebos",
      title: "Беседка №1",
      url: "https://avito.ru/x",
    });
    // Step "find open" — return a message linking to an open task.
    m.avitoMessageFindFirst
      .mockResolvedValueOnce({ taskId: "task-open" }); // findOpenTaskByChatId
    m.taskFindUnique.mockResolvedValueOnce({
      id: "task-open",
      publicId: "TASK-OPENX",
      boardId: "board-1",
      columnId: "col-1",
      externalContact: { source: "avito", avitoChatId: "chat-1" },
      closedAt: null,
      title: "old title",
      source: "API",
    });

    const result = await routeInboundMessage(baseInput);

    expect(result.idempotent).toBe(false);
    expect(result.created).toBe(false);
    expect(result.reopened).toBe(false);
    expect(result.autoReplyEligible).toBe(false);
    expect(m.taskCommentCreate).toHaveBeenCalledOnce();
    expect(m.taskCreate).not.toHaveBeenCalled();
    expect(m.taskUpdate).toHaveBeenCalled(); // for touchTaskMetadata
  });
});

describe("routeInboundMessage — branch 2: closed task within reopen window", () => {
  it("reopens the task and appends comment, no autoReply", async () => {
    m.avitoMessageCreate.mockResolvedValueOnce({ id: "row-1" });
    m.avitoItemFindUnique.mockResolvedValueOnce({
      id: "item-db",
      moduleSlug: "gazebos",
      title: "Беседка №1",
      url: null,
    });
    // No open task found.
    m.avitoMessageFindFirst
      .mockResolvedValueOnce(null) // findOpenTaskByChatId
      .mockResolvedValueOnce({ taskId: "task-closed" }); // findRecentlyClosed
    m.taskFindUnique.mockResolvedValueOnce({
      id: "task-closed",
      boardId: "board-1",
      columnId: "col-old",
      closedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      externalContact: {},
      source: "API",
    });
    m.taskColumnFindFirst.mockResolvedValueOnce({ id: "col-first" });

    const result = await routeInboundMessage(baseInput);

    expect(result.reopened).toBe(true);
    expect(result.created).toBe(false);
    expect(result.autoReplyEligible).toBe(false);
    expect(m.taskUpdate).toHaveBeenCalled(); // reopen + touchTaskMetadata
    expect(m.taskCommentCreate).toHaveBeenCalledOnce();
    // STATUS_CHANGED + COMMENT_ADDED events
    expect(m.taskEventCreate).toHaveBeenCalledTimes(2);
  });
});

describe("routeInboundMessage — branch 3: no related task, create new", () => {
  it("creates a new task in the gazebos category and marks autoReplyEligible", async () => {
    m.avitoMessageCreate.mockResolvedValueOnce({ id: "row-1" });
    m.avitoItemFindUnique.mockResolvedValueOnce({
      id: "item-db",
      moduleSlug: "gazebos",
      title: "Беседка №1",
      url: "https://avito.ru/x",
    });
    m.avitoMessageFindFirst
      .mockResolvedValueOnce(null) // findOpenTaskByChatId
      .mockResolvedValueOnce(null); // findRecentlyClosed
    m.taskCategoryFindUnique.mockResolvedValueOnce({
      id: "cat-gazebos",
      slug: "avito-lead-gazebos",
      defaultBoardId: null,
      priorityHint: "HIGH",
      defaultResponsibleUserId: null,
    });
    m.taskBoardFindUnique.mockResolvedValueOnce({
      id: "board-gazebos",
      isArchived: false,
    });
    m.taskColumnFindFirst.mockResolvedValueOnce({ id: "col-first" });
    m.taskCreate.mockResolvedValueOnce({
      id: "task-new",
      publicId: "TASK-ABCDE",
      boardId: "board-gazebos",
      columnId: "col-first",
      title: "Авито: Иван — Беседка №1",
      externalContact: {},
      source: "API",
    });

    const result = await routeInboundMessage(baseInput);

    expect(result.created).toBe(true);
    expect(result.autoReplyEligible).toBe(true);
    expect(result.moduleSlug).toBe("gazebos");
    expect(m.taskCreate).toHaveBeenCalledOnce();
    expect(m.taskCommentCreate).toHaveBeenCalledOnce();
    // CREATED event from createNewLeadTask + COMMENT_ADDED from appendInbound
    expect(m.taskEventCreate).toHaveBeenCalledTimes(2);
  });

  it("uses unassigned category when avitoItem has no moduleSlug", async () => {
    m.avitoMessageCreate.mockResolvedValueOnce({ id: "row-1" });
    m.avitoItemFindUnique.mockResolvedValueOnce({
      id: "item-db",
      moduleSlug: null,
      title: "Объявление",
      url: null,
    });
    m.avitoMessageFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    m.taskCategoryFindUnique.mockResolvedValueOnce({
      id: "cat-un",
      slug: "avito-lead-unassigned",
      defaultBoardId: null,
      priorityHint: "MEDIUM",
      defaultResponsibleUserId: null,
    });
    m.taskBoardFindFirst.mockResolvedValueOnce({ id: "board-default" });
    m.taskColumnFindFirst.mockResolvedValueOnce({ id: "col-first" });
    m.taskCreate.mockResolvedValueOnce({
      id: "task-new",
      publicId: "TASK-XXXXX",
      boardId: "board-default",
      columnId: "col-first",
      title: "Авито: Иван",
      externalContact: {},
      source: "API",
    });

    const result = await routeInboundMessage(baseInput);

    expect(result.created).toBe(true);
    expect(result.moduleSlug).toBeNull();
    expect(m.taskCategoryFindUnique).toHaveBeenCalledWith({
      where: { slug: "avito-lead-unassigned" },
    });
  });
});

describe("routeInboundMessage — idempotency", () => {
  it("on UNIQUE conflict (P2002) returns idempotent without side effects", async () => {
    const conflictErr = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      { code: "P2002", clientVersion: "test" }
    );
    m.avitoMessageCreate.mockRejectedValueOnce(conflictErr);
    m.avitoMessageFindUnique.mockResolvedValueOnce({
      taskId: "task-existing",
      avitoItem: { moduleSlug: "gazebos" },
    });
    m.taskFindUnique.mockResolvedValueOnce({
      id: "task-existing",
      publicId: "TASK-EXIST",
      boardId: "b",
      columnId: "c",
      externalContact: {},
    });

    const result = await routeInboundMessage(baseInput);

    expect(result.idempotent).toBe(true);
    expect(result.task.id).toBe("task-existing");
    expect(result.moduleSlug).toBe("gazebos");
    expect(m.taskCreate).not.toHaveBeenCalled();
    expect(m.taskCommentCreate).not.toHaveBeenCalled();
    expect(m.taskEventCreate).not.toHaveBeenCalled();
  });
});
