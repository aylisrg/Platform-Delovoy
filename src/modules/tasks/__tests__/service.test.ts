import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (must be declared BEFORE importing the module under test) ──────────

vi.mock("@/lib/db", () => ({
  prisma: {
    task: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
    taskEvent: { create: vi.fn() },
    taskComment: { create: vi.fn(), findUnique: vi.fn() },
    taskCategory: { findUnique: vi.fn() },
    module: { findUnique: vi.fn() },
    user: { findMany: vi.fn(() => Promise.resolve([])) },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/logger", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    critical: vi.fn(),
  },
  logAudit: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@/modules/notifications/channels/email", () => ({
  sendTransactionalEmail: vi.fn(() => Promise.resolve({ success: true })),
}));

vi.mock("@/modules/notifications/channels/telegram", () => ({
  telegramAdapter: {
    channel: "TELEGRAM",
    send: vi.fn(() => Promise.resolve({ success: true })),
    resolveRecipient: vi.fn(() => null),
  },
}));

// Dynamic imports so mocks apply
const { prisma } = await import("@/lib/db");
const { logAudit } = await import("@/lib/logger");
const { sendTransactionalEmail } = await import(
  "@/modules/notifications/channels/email"
);
const {
  createTask,
  updateStatus,
  updateAssignee,
  addComment,
  listTasks,
} = await import("../service");

// ────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createTask", () => {
  it("generates a publicId and creates CREATED event", async () => {
    (prisma.taskCategory.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.module.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.task.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "t1",
      publicId: "TASK-ABCDE",
      type: "INTERNAL",
      source: "MANUAL",
      title: "Hello",
      assigneeUserId: null,
      externalContact: null,
    });

    const task = await createTask(
      { title: "Hello", type: "INTERNAL", source: "MANUAL", labels: [] },
      { id: null, source: "system" }
    );

    expect(task.publicId).toMatch(/^TASK-/);
    expect(prisma.task.create).toHaveBeenCalledOnce();
    expect(prisma.taskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: "CREATED" }) })
    );
  });

  it("routes assignee via category.defaultAssignee when provided", async () => {
    (prisma.taskCategory.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      defaultAssigneeUserId: "u-plumber",
      isActive: true,
    });
    (prisma.task.create as ReturnType<typeof vi.fn>).mockImplementation((args) => ({
      id: "t2",
      publicId: args.data.publicId,
      type: "ISSUE",
      source: "WEB",
      title: args.data.title,
      assigneeUserId: args.data.assigneeUserId,
      externalContact: args.data.externalContact ?? null,
    }));

    const task = await createTask(
      {
        title: "Протечка",
        type: "ISSUE",
        source: "WEB",
        categoryId: "cat-plumbing",
        labels: [],
      },
      { id: null, source: "system" }
    );

    expect(task.assigneeUserId).toBe("u-plumber");
    const eventKinds = (prisma.taskEvent.create as ReturnType<typeof vi.fn>)
      .mock.calls.map((c) => c[0].data.kind);
    expect(eventKinds).toContain("CREATED");
    expect(eventKinds).toContain("ASSIGNED");
  });

  it("retries on publicId collision", async () => {
    (prisma.taskCategory.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.module.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const collisionErr = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
    });
    const create = prisma.task.create as ReturnType<typeof vi.fn>;
    create
      .mockRejectedValueOnce(collisionErr)
      .mockResolvedValueOnce({
        id: "t3",
        publicId: "TASK-ZZZZZ",
        type: "INTERNAL",
        source: "MANUAL",
        title: "Ok",
        assigneeUserId: null,
        externalContact: null,
      });

    const task = await createTask(
      { title: "Ok", labels: [] },
      { id: null, source: "system" }
    );
    expect(task.publicId).toBe("TASK-ZZZZZ");
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("writes an audit entry for user-initiated creates", async () => {
    (prisma.taskCategory.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.module.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.task.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "t4",
      publicId: "TASK-FFFFF",
      type: "INTERNAL",
      source: "MANUAL",
      title: "From UI",
      assigneeUserId: null,
      externalContact: null,
    });

    await createTask(
      { title: "From UI", labels: [] },
      { id: "actor-u", source: "user" }
    );

    expect(logAudit).toHaveBeenCalledWith(
      "actor-u",
      "task.create",
      "Task",
      "t4",
      expect.any(Object)
    );
  });

  it("sends reporter confirmation email for ISSUE with externalContact.email", async () => {
    (prisma.taskCategory.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.module.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.task.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "t5",
      publicId: "TASK-HHHHH",
      type: "ISSUE",
      source: "WEB",
      title: "Что-то сломалось",
      assigneeUserId: null,
      externalContact: { email: "client@example.com", name: "Client" },
    });

    await createTask(
      {
        title: "Что-то сломалось",
        type: "ISSUE",
        source: "WEB",
        labels: [],
        externalContact: { email: "client@example.com", name: "Client" },
      },
      { id: null, source: "system" }
    );

    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "client@example.com" })
    );
  });
});

describe("updateStatus", () => {
  it("no-ops when status is unchanged", async () => {
    (prisma.task.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "t1",
      publicId: "TASK-AAAAA",
      status: "TODO",
      assigneeUserId: null,
      title: "x",
    });
    const res = await updateStatus("t1", "TODO", { id: "u1" });
    expect(res).toBeTruthy();
    expect(prisma.task.update).not.toHaveBeenCalled();
  });

  it("writes STATUS_CHANGED event on transition", async () => {
    (prisma.task.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "t1",
      publicId: "TASK-AAAAA",
      status: "TODO",
      assigneeUserId: null,
      title: "x",
    });
    (prisma.task.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "t1",
      publicId: "TASK-AAAAA",
      status: "IN_PROGRESS",
      assigneeUserId: null,
    });
    await updateStatus("t1", "IN_PROGRESS", { id: "u1" });
    const kind = (prisma.taskEvent.create as ReturnType<typeof vi.fn>).mock
      .calls[0][0].data.kind;
    expect(kind).toBe("STATUS_CHANGED");
  });

  it("writes RESOLVED + resolvedAt when moving to DONE", async () => {
    (prisma.task.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "t1",
      publicId: "TASK-AAAAA",
      status: "IN_PROGRESS",
      assigneeUserId: null,
      title: "x",
    });
    (prisma.task.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "t1",
      publicId: "TASK-AAAAA",
      status: "DONE",
      assigneeUserId: null,
    });
    await updateStatus("t1", "DONE", { id: "u1" });
    const update = (prisma.task.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(update.data.resolvedAt).toBeInstanceOf(Date);
    const kind = (prisma.taskEvent.create as ReturnType<typeof vi.fn>).mock
      .calls[0][0].data.kind;
    expect(kind).toBe("RESOLVED");
  });
});

describe("updateAssignee", () => {
  it("no-ops when assignee is unchanged", async () => {
    (prisma.task.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "t1",
      publicId: "TASK-AAAAA",
      assigneeUserId: "u-same",
      title: "x",
    });
    await updateAssignee("t1", "u-same", { id: "u1" });
    expect(prisma.task.update).not.toHaveBeenCalled();
  });

  it("writes ASSIGNED event on change", async () => {
    (prisma.task.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "t1",
      publicId: "TASK-AAAAA",
      assigneeUserId: null,
      title: "x",
    });
    (prisma.task.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "t1",
      publicId: "TASK-AAAAA",
      assigneeUserId: "u-new",
    });
    await updateAssignee("t1", "u-new", { id: "u1" });
    const kind = (prisma.taskEvent.create as ReturnType<typeof vi.fn>).mock
      .calls[0][0].data.kind;
    expect(kind).toBe("ASSIGNED");
  });
});

describe("addComment", () => {
  it("creates comment + COMMENTED event", async () => {
    (prisma.task.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "t1",
      publicId: "TASK-AAAAA",
      title: "x",
      assigneeUserId: null,
    });
    (prisma.taskComment.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "c1",
      taskId: "t1",
      body: "Готово",
    });
    const comment = await addComment(
      "t1",
      { body: "Готово", source: "WEB" },
      { id: "author-u" }
    );
    expect(comment?.id).toBe("c1");
    const kind = (prisma.taskEvent.create as ReturnType<typeof vi.fn>).mock
      .calls[0][0].data.kind;
    expect(kind).toBe("COMMENTED");
  });

  it("is idempotent for email-sourced comments with same Message-ID", async () => {
    (prisma.task.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "t1",
      publicId: "TASK-AAAAA",
      title: "x",
      assigneeUserId: null,
    });
    (prisma.taskComment.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "c-existing",
    });
    const comment = await addComment(
      "t1",
      { body: "Дубликат", source: "EMAIL" },
      { id: null, externalContact: { email: "x@y.com" } },
      { emailMessageId: "<msg-123@mail>" }
    );
    expect(comment?.id).toBe("c-existing");
    expect(prisma.taskComment.create).not.toHaveBeenCalled();
    expect(prisma.taskEvent.create).not.toHaveBeenCalled();
  });
});

describe("listTasks", () => {
  it("returns empty for USER scope", async () => {
    const r = await listTasks(
      { page: 1, pageSize: 20 },
      { role: "USER" }
    );
    expect(r).toEqual({ items: [], total: 0 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("applies MANAGER visibility filters", async () => {
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockResolvedValue([0, []]);
    await listTasks(
      { page: 1, pageSize: 20 },
      { role: "MANAGER", userId: "m1", categoryIds: ["cat-plumb"] }
    );
    const call = (prisma.$transaction as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(Array.isArray(call)).toBe(true);
  });
});
