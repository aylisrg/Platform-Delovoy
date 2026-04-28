/**
 * Unit tests for src/lib/avito/calls.ts.
 *
 * Mocks @/lib/db so no real DB is touched. The mock is shaped just deeply
 * enough to drive `processCallWebhook` and `createTaskFromMissedCall`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// === Mocks =========================================================

// vi.mock is hoisted — keep the mock object in vi.hoisted so its
// reference is available at hoist-time without crashing.
const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    avitoItem: { findUnique: vi.fn() },
    avitoCallEvent: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    taskCategory: { upsert: vi.fn() },
    taskBoard: { findFirst: vi.fn() },
    taskColumn: { findFirst: vi.fn() },
    task: { create: vi.fn() },
    taskEvent: { create: vi.fn() },
    taskAssignee: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    systemEvent: { create: vi.fn() },
    user: { findFirst: vi.fn() },
    tenant: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

// Stub the dispatch import — we only care that processCall doesn't throw.
vi.mock("@/modules/tasks/notify", () => ({
  dispatchTaskEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/modules/tasks/public-id", () => ({
  generatePublicId: vi.fn(() => "TASK-TEST1"),
}));

import {
  AvitoCallWebhookSchema,
  processCallWebhook,
  createTaskFromMissedCall,
} from "../calls";

const VALID_PAYLOAD = {
  id: "evt-uuid-1",
  payload: {
    type: "call.missed" as const,
    value: {
      call_id: "call-123",
      item_id: 1234567890,
      caller_phone: "+79001234567",
      duration: 0,
      started_at: 1714300000,
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();

  // Default returns — most tests will override.
  prismaMock.avitoItem.findUnique.mockResolvedValue(null);
  prismaMock.avitoCallEvent.findUnique.mockResolvedValue(null);
  prismaMock.avitoCallEvent.update.mockResolvedValue({});
  prismaMock.taskCategory.upsert.mockResolvedValue({
    id: "cat-id",
    defaultBoardId: null,
    defaultResponsibleUserId: null,
    priorityHint: "HIGH",
  });
  prismaMock.taskBoard.findFirst.mockResolvedValue({ id: "board-default" });
  prismaMock.taskColumn.findFirst.mockResolvedValue({ id: "col-first" });
  prismaMock.task.create.mockResolvedValue({ id: "task-1", publicId: "TASK-TEST1" });
  prismaMock.taskEvent.create.mockResolvedValue({});
  prismaMock.taskAssignee.create.mockResolvedValue({});
  prismaMock.auditLog.create.mockResolvedValue({});
  prismaMock.systemEvent.create.mockResolvedValue({});
  prismaMock.user.findFirst.mockResolvedValue(null);
  prismaMock.tenant.findFirst.mockResolvedValue(null);
});

// === Schema ========================================================

describe("AvitoCallWebhookSchema", () => {
  it("parses a valid call.missed payload", () => {
    const result = AvitoCallWebhookSchema.safeParse(VALID_PAYLOAD);
    expect(result.success).toBe(true);
    if (!result.success) return;
    // call_id and item_id are coerced to strings at the schema boundary.
    expect(result.data.payload.value.call_id).toBe("call-123");
    expect(result.data.payload.value.item_id).toBe("1234567890");
  });

  it("accepts string call_id and string item_id", () => {
    const result = AvitoCallWebhookSchema.safeParse({
      ...VALID_PAYLOAD,
      payload: {
        ...VALID_PAYLOAD.payload,
        value: {
          ...VALID_PAYLOAD.payload.value,
          call_id: "call-abc",
          item_id: "9876",
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects payload with missing call_id", () => {
    const broken = {
      ...VALID_PAYLOAD,
      payload: {
        ...VALID_PAYLOAD.payload,
        value: {
          item_id: 1,
          started_at: 1,
        },
      },
    };
    expect(AvitoCallWebhookSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects unknown call type", () => {
    const broken = {
      ...VALID_PAYLOAD,
      payload: {
        ...VALID_PAYLOAD.payload,
        type: "call.invalid_kind",
      },
    };
    expect(AvitoCallWebhookSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects empty call_id", () => {
    const broken = {
      ...VALID_PAYLOAD,
      payload: {
        ...VALID_PAYLOAD.payload,
        value: { ...VALID_PAYLOAD.payload.value, call_id: "" },
      },
    };
    expect(AvitoCallWebhookSchema.safeParse(broken).success).toBe(false);
  });
});

// === processCallWebhook ============================================

describe("processCallWebhook — idempotency", () => {
  it("creates AvitoCallEvent on first call and a Task for missed calls", async () => {
    prismaMock.avitoItem.findUnique.mockResolvedValue({ id: "ai-1" });
    prismaMock.avitoCallEvent.create.mockResolvedValue({
      id: "ce-1",
      status: "MISSED",
      avitoItemId: "ai-1",
      callerPhone: "+79001234567",
      startedAt: new Date(VALID_PAYLOAD.payload.value.started_at * 1000),
    });

    // Reset the avitoItem.findUnique sequence: first call resolves the FK,
    // second call inside `createTaskFromMissedCall` resolves moduleSlug.
    prismaMock.avitoItem.findUnique
      .mockResolvedValueOnce({ id: "ai-1" })
      .mockResolvedValueOnce({
        moduleSlug: "gazebos",
        avitoItemId: "1234567890",
        title: "Беседка №1",
      });

    const parsed = AvitoCallWebhookSchema.parse(VALID_PAYLOAD);
    const result = await processCallWebhook(parsed);

    expect(result.created).toBe(true);
    expect(result.callEventId).toBe("ce-1");
    expect(result.taskCreated).toBe(true);
    expect(prismaMock.avitoCallEvent.create).toHaveBeenCalledOnce();
    expect(prismaMock.task.create).toHaveBeenCalledOnce();
    expect(prismaMock.avitoCallEvent.update).toHaveBeenCalledWith({
      where: { id: "ce-1" },
      data: { taskId: "task-1" },
    });
  });

  it("returns no-op result when call_id duplicates an existing AvitoCallEvent", async () => {
    // Simulate UNIQUE-constraint violation from Prisma.
    const p2002 = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
    });
    prismaMock.avitoCallEvent.create.mockRejectedValue(p2002);
    prismaMock.avitoCallEvent.findUnique.mockResolvedValue({
      id: "ce-existing",
      status: "MISSED",
      avitoItemId: null,
      callerPhone: null,
      startedAt: new Date(),
    });

    const parsed = AvitoCallWebhookSchema.parse({
      ...VALID_PAYLOAD,
      payload: {
        ...VALID_PAYLOAD.payload,
        value: { ...VALID_PAYLOAD.payload.value, item_id: undefined },
      },
    });

    const result = await processCallWebhook(parsed);

    expect(result.created).toBe(false);
    expect(result.callEventId).toBe("ce-existing");
    expect(result.taskCreated).toBe(false);
    expect(prismaMock.task.create).not.toHaveBeenCalled();
  });

  it("does NOT create a Task for call.answered events", async () => {
    prismaMock.avitoCallEvent.create.mockResolvedValue({
      id: "ce-ans",
      status: "ANSWERED",
      avitoItemId: null,
      callerPhone: null,
      startedAt: new Date(),
    });

    const parsed = AvitoCallWebhookSchema.parse({
      ...VALID_PAYLOAD,
      payload: {
        ...VALID_PAYLOAD.payload,
        type: "call.answered",
        value: { ...VALID_PAYLOAD.payload.value, item_id: undefined },
      },
    });

    const result = await processCallWebhook(parsed);
    expect(result.created).toBe(true);
    expect(result.taskCreated).toBe(false);
    expect(prismaMock.task.create).not.toHaveBeenCalled();
  });
});

// === createTaskFromMissedCall ======================================

describe("createTaskFromMissedCall — category routing", () => {
  it("routes to avito-missed-call-gazebos when item.moduleSlug = gazebos", async () => {
    prismaMock.avitoItem.findUnique.mockResolvedValue({
      moduleSlug: "gazebos",
      avitoItemId: "111",
      title: "Беседка №1",
    });

    await createTaskFromMissedCall({
      callEventId: "ce-x",
      avitoItemDbId: "ai-x",
      callerPhone: null,
      startedAt: new Date(),
    });

    expect(prismaMock.taskCategory.upsert).toHaveBeenCalledOnce();
    const upsertArgs = prismaMock.taskCategory.upsert.mock.calls[0][0];
    expect(upsertArgs.where).toEqual({ slug: "avito-missed-call-gazebos" });
    expect(upsertArgs.create.priorityHint).toBe("HIGH");
  });

  it("routes to avito-missed-call-ps-park when item.moduleSlug = ps-park", async () => {
    prismaMock.avitoItem.findUnique.mockResolvedValue({
      moduleSlug: "ps-park",
      avitoItemId: "222",
      title: "PlayStation",
    });

    await createTaskFromMissedCall({
      callEventId: "ce-x",
      avitoItemDbId: "ai-x",
      callerPhone: null,
      startedAt: new Date(),
    });

    const upsertArgs = prismaMock.taskCategory.upsert.mock.calls[0][0];
    expect(upsertArgs.where).toEqual({ slug: "avito-missed-call-ps-park" });
  });

  it("routes to avito-missed-call-unassigned when AvitoItem is missing", async () => {
    await createTaskFromMissedCall({
      callEventId: "ce-x",
      avitoItemDbId: null,
      callerPhone: null,
      startedAt: new Date(),
    });

    const upsertArgs = prismaMock.taskCategory.upsert.mock.calls[0][0];
    expect(upsertArgs.where).toEqual({ slug: "avito-missed-call-unassigned" });
    // AvitoItem.findUnique should NOT be called when no FK is provided.
    expect(prismaMock.avitoItem.findUnique).not.toHaveBeenCalled();
  });

  it("routes to unassigned when AvitoItem has null moduleSlug", async () => {
    prismaMock.avitoItem.findUnique.mockResolvedValue({
      moduleSlug: null,
      avitoItemId: "333",
      title: "Без модуля",
    });

    await createTaskFromMissedCall({
      callEventId: "ce-x",
      avitoItemDbId: "ai-x",
      callerPhone: null,
      startedAt: new Date(),
    });

    const upsertArgs = prismaMock.taskCategory.upsert.mock.calls[0][0];
    expect(upsertArgs.where).toEqual({ slug: "avito-missed-call-unassigned" });
  });

  it("uses category.defaultBoardId when set, otherwise falls back to default board", async () => {
    prismaMock.taskCategory.upsert.mockResolvedValue({
      id: "cat-with-board",
      defaultBoardId: "board-X",
      defaultResponsibleUserId: null,
      priorityHint: "HIGH",
    });

    await createTaskFromMissedCall({
      callEventId: "ce-x",
      avitoItemDbId: null,
      callerPhone: null,
      startedAt: new Date(),
    });

    expect(prismaMock.taskBoard.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.taskColumn.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { boardId: "board-X" } })
    );
  });
});

describe("createTaskFromMissedCall — phone matching", () => {
  it("links to User when User.phone matches normalized number", async () => {
    prismaMock.user.findFirst.mockResolvedValue({ id: "user-42" });

    await createTaskFromMissedCall({
      callEventId: "ce-phone",
      avitoItemDbId: null,
      callerPhone: "+79001234567",
      startedAt: new Date(),
    });

    expect(prismaMock.user.findFirst).toHaveBeenCalled();
    // Inspect the metadata payload passed to taskEvent.create.
    const eventArgs = prismaMock.taskEvent.create.mock.calls[0][0];
    expect(eventArgs.data.metadata).toMatchObject({
      source: "avito",
      kind: "missed_call",
      linkedUserId: "user-42",
    });
  });

  it("links to Tenant when Tenant.phone matches", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.tenant.findFirst.mockResolvedValue({ id: "tenant-7" });

    await createTaskFromMissedCall({
      callEventId: "ce-phone",
      avitoItemDbId: null,
      callerPhone: "+79001234567",
      startedAt: new Date(),
    });

    const eventArgs = prismaMock.taskEvent.create.mock.calls[0][0];
    expect(eventArgs.data.metadata).toMatchObject({ linkedTenantId: "tenant-7" });
    expect(eventArgs.data.metadata).not.toHaveProperty("linkedUserId");
  });

  it("does not set linkedUserId when phone is null", async () => {
    await createTaskFromMissedCall({
      callEventId: "ce-no-phone",
      avitoItemDbId: null,
      callerPhone: null,
      startedAt: new Date(),
    });

    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.tenant.findFirst).not.toHaveBeenCalled();
    const eventArgs = prismaMock.taskEvent.create.mock.calls[0][0];
    expect(eventArgs.data.metadata).not.toHaveProperty("linkedUserId");
    expect(eventArgs.data.metadata).not.toHaveProperty("linkedTenantId");
  });
});
