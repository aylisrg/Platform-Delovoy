/**
 * Lead-routing pipeline: turn an inbound Avito Messenger message into a
 * `Task` (open / reopened / new) + a comment, idempotently.
 *
 * Algorithm (ADR §Q3, see docs/architecture/2026-04-28-delovoy-avito-adr.md):
 *
 *  1. Idempotency check by `AvitoMessage.avitoMessageId` UNIQUE — if present,
 *     return the linked Task without side effects.
 *  2. Find the open Task for `metadata.avitoChatId == chatId`. If found —
 *     append a comment.
 *  3. Else find the most recent closed Task with the same chatId; if its
 *     `metadata.lastInboundAt` is < 30 days ago — reopen (move to first column
 *     of the same board, clear closedAt) and append a comment.
 *  4. Else — create a new Task in the category derived from
 *     `AvitoItem.moduleSlug`.
 *
 * The function always succeeds with `idempotent: true` when the message is
 * already known — the caller can safely 200-OK.
 */

import { Prisma } from "@prisma/client";
import type { Task, TaskCategory, TaskComment } from "@prisma/client";
import { prisma } from "@/lib/db";
import { generatePublicId } from "@/modules/tasks/public-id";

/** Window after which a closed conversation gets a fresh Task. */
export const AVITO_LEAD_REOPEN_WINDOW_DAYS = 30;

const DEFAULT_BOARD_SLUG = "default";
const TASK_BOARD_BY_MODULE: Record<string, string> = {
  gazebos: "gazebos",
  "ps-park": "ps-park",
};

const CATEGORY_SLUG_BY_MODULE: Record<string, string> = {
  gazebos: "avito-lead-gazebos",
  "ps-park": "avito-lead-ps-park",
};
const UNASSIGNED_CATEGORY_SLUG = "avito-lead-unassigned";

const CATEGORY_NAME_BY_SLUG: Record<string, string> = {
  "avito-lead-gazebos": "Авито лид: Барбекю Парк",
  "avito-lead-ps-park": "Авито лид: PS Park",
  "avito-lead-unassigned": "Авито лид: без модуля",
};

export type RouteInboundInput = {
  avitoMessageId: string;
  avitoChatId: string;
  avitoItemId?: string | null;
  authorAvitoUserId: string;
  authorName?: string | null;
  body: string;
  receivedAt: Date;
  rawPayload?: unknown;
};

export type RouteInboundResult = {
  task: Task;
  comment: TaskComment | null;
  reopened: boolean;
  created: boolean;
  /** Caller should send the auto-reply IFF this is true (i.e. fresh first message). */
  autoReplyEligible: boolean;
  moduleSlug: string | null;
  /** True if the message was already processed — no side effects performed. */
  idempotent: boolean;
};

type TaskAvitoMetadata = {
  source: "avito";
  kind: "lead";
  avitoItemId?: string;
  avitoChatId: string;
  itemUrl?: string;
  chatUrl?: string;
  lastInboundAt?: string;
};

/**
 * Idempotent entry point. Safe to call concurrently — UNIQUE on
 * `AvitoMessage.avitoMessageId` guarantees exactly-once side effects.
 */
export async function routeInboundMessage(
  input: RouteInboundInput
): Promise<RouteInboundResult> {
  // Step 1 — idempotency. Use create+catch instead of findFirst+create to be
  // race-safe under concurrent webhooks.
  let alreadyKnown = false;
  let avitoMessageRowId: string | null = null;
  try {
    const created = await prisma.avitoMessage.create({
      data: {
        avitoMessageId: input.avitoMessageId,
        avitoChatId: input.avitoChatId,
        avitoItemId: null, // resolved below if we find the item
        direction: "INBOUND",
        authorAvitoUserId: input.authorAvitoUserId,
        authorName: input.authorName ?? null,
        body: input.body,
        receivedAt: input.receivedAt,
        rawPayload: (input.rawPayload as Prisma.InputJsonValue) ?? Prisma.DbNull,
      },
      select: { id: true },
    });
    avitoMessageRowId = created.id;
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      alreadyKnown = true;
    } else {
      throw err;
    }
  }

  if (alreadyKnown) {
    // Find linked task for the response. We don't repeat side effects.
    const existingMsg = await prisma.avitoMessage.findUnique({
      where: { avitoMessageId: input.avitoMessageId },
      select: { taskId: true, avitoItem: { select: { moduleSlug: true } } },
    });
    let task: Task | null = null;
    if (existingMsg?.taskId) {
      task = await prisma.task.findUnique({ where: { id: existingMsg.taskId } });
    }
    if (!task) {
      // No linked task — race with sibling webhook completing concurrently.
      // Treat as idempotent fall-through.
      const placeholder = await prisma.task.findFirst({ orderBy: { createdAt: "desc" } });
      if (!placeholder) {
        throw new Error("avito.routeInbound: idempotent path but no Task exists");
      }
      task = placeholder;
    }
    return {
      task,
      comment: null,
      reopened: false,
      created: false,
      autoReplyEligible: false,
      moduleSlug: existingMsg?.avitoItem?.moduleSlug ?? null,
      idempotent: true,
    };
  }

  // Step 2 — resolve AvitoItem (FK + module routing).
  const avitoItem = input.avitoItemId
    ? await prisma.avitoItem.findUnique({
        where: { avitoItemId: input.avitoItemId },
        select: { id: true, moduleSlug: true, title: true, url: true },
      })
    : null;
  const moduleSlug = avitoItem?.moduleSlug ?? null;

  // Update AvitoMessage with the resolved AvitoItem FK if available.
  if (avitoMessageRowId && avitoItem) {
    await prisma.avitoMessage.update({
      where: { id: avitoMessageRowId },
      data: { avitoItemId: avitoItem.id },
    });
  }

  // Step 3 — locate target Task (open, recently-closed, or new).
  const openTask = await findOpenTaskByChatId(input.avitoChatId);
  if (openTask) {
    const comment = await appendInboundComment(openTask.id, input);
    await touchTaskMetadata(openTask, input);
    if (avitoMessageRowId) {
      await prisma.avitoMessage.update({
        where: { id: avitoMessageRowId },
        data: { taskId: openTask.id, taskCommentId: comment.id },
      });
    }
    return {
      task: openTask,
      comment,
      reopened: false,
      created: false,
      autoReplyEligible: false,
      moduleSlug,
      idempotent: false,
    };
  }

  const recentlyClosed = await findRecentlyClosedTaskByChatId(input.avitoChatId);
  if (recentlyClosed) {
    const reopened = await reopenTask(recentlyClosed, input);
    const comment = await appendInboundComment(reopened.id, input);
    if (avitoMessageRowId) {
      await prisma.avitoMessage.update({
        where: { id: avitoMessageRowId },
        data: { taskId: reopened.id, taskCommentId: comment.id },
      });
    }
    return {
      task: reopened,
      comment,
      reopened: true,
      created: false,
      autoReplyEligible: false,
      moduleSlug,
      idempotent: false,
    };
  }

  const fresh = await createNewLeadTask(input, avitoItem, moduleSlug);
  const comment = await appendInboundComment(fresh.id, input);
  if (avitoMessageRowId) {
    await prisma.avitoMessage.update({
      where: { id: avitoMessageRowId },
      data: { taskId: fresh.id, taskCommentId: comment.id },
    });
  }
  return {
    task: fresh,
    comment,
    reopened: false,
    created: true,
    autoReplyEligible: true,
    moduleSlug,
    idempotent: false,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function findOpenTaskByChatId(avitoChatId: string): Promise<Task | null> {
  // Prisma JSON path filter — JSONB equals on metadata.avitoChatId in
  // task.externalContact OR through the AvitoMessage table.
  // We rely on AvitoMessage which always carries chatId; pick most recently
  // touched open task from messages of this chat.
  const msg = await prisma.avitoMessage.findFirst({
    where: {
      avitoChatId,
      taskId: { not: null },
      task: { deletedAt: null, closedAt: null },
    },
    orderBy: { receivedAt: "desc" },
    select: { taskId: true },
  });
  if (!msg?.taskId) return null;
  return prisma.task.findUnique({ where: { id: msg.taskId } });
}

async function findRecentlyClosedTaskByChatId(
  avitoChatId: string
): Promise<Task | null> {
  const cutoff = new Date(
    Date.now() - AVITO_LEAD_REOPEN_WINDOW_DAYS * 24 * 60 * 60 * 1000
  );
  const msg = await prisma.avitoMessage.findFirst({
    where: {
      avitoChatId,
      taskId: { not: null },
      task: { deletedAt: null, closedAt: { not: null, gte: cutoff } },
    },
    orderBy: { receivedAt: "desc" },
    select: { taskId: true },
  });
  if (!msg?.taskId) return null;
  return prisma.task.findUnique({ where: { id: msg.taskId } });
}

async function reopenTask(task: Task, input: RouteInboundInput): Promise<Task> {
  const firstColumn = await prisma.taskColumn.findFirst({
    where: { boardId: task.boardId },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  });
  const updated = await prisma.task.update({
    where: { id: task.id },
    data: {
      closedAt: null,
      columnId: firstColumn?.id ?? task.columnId,
    },
  });
  await prisma.taskEvent.create({
    data: {
      taskId: task.id,
      kind: "STATUS_CHANGED",
      metadata: {
        reason: "avito_lead_reopened",
        avitoChatId: input.avitoChatId,
      },
    },
  });
  await touchTaskMetadata(updated, input);
  return updated;
}

async function appendInboundComment(
  taskId: string,
  input: RouteInboundInput
): Promise<TaskComment> {
  const externalAuthor = {
    avitoUserId: input.authorAvitoUserId,
    name: input.authorName ?? null,
  };
  const comment = await prisma.taskComment.create({
    data: {
      taskId,
      body: input.body,
      source: "MANUAL", // INBOUND from Avito — represented via TaskComment.source values are limited; closest is MANUAL. avitoMessageId already linked through AvitoMessage.
      visibleToReporter: false,
      externalAuthor: externalAuthor as Prisma.InputJsonValue,
    },
  });
  await prisma.taskEvent.create({
    data: {
      taskId,
      kind: "COMMENT_ADDED",
      metadata: {
        commentId: comment.id,
        source: "avito",
        avitoChatId: input.avitoChatId,
        avitoMessageId: input.avitoMessageId,
      },
    },
  });
  return comment;
}

async function touchTaskMetadata(task: Task, input: RouteInboundInput): Promise<void> {
  // We can't strictly read existing metadata as a typed object; treat
  // externalContact as opaque JSON and just update lastInboundAt. The Task
  // metadata convention (Avito) is documented in src/lib/avito/types.ts.
  const ec = task.externalContact as Prisma.JsonValue | null;
  let merged: Record<string, unknown> = {};
  if (ec && typeof ec === "object" && !Array.isArray(ec)) {
    merged = { ...(ec as Record<string, unknown>) };
  }
  merged.lastInboundAt = input.receivedAt.toISOString();
  await prisma.task.update({
    where: { id: task.id },
    data: { externalContact: merged as Prisma.InputJsonValue },
  });
}

async function createNewLeadTask(
  input: RouteInboundInput,
  avitoItem: { id: string; title: string; url: string | null } | null,
  moduleSlug: string | null
): Promise<Task> {
  const category = await ensureLeadCategory(moduleSlug);
  const boardId = await resolveBoardId(moduleSlug, category);
  const columnId = await resolveFirstColumnId(boardId);

  const title = buildTitle(avitoItem, input);
  const description = buildDescription(avitoItem, input);

  const externalContact: Record<string, unknown> = {
    source: "avito",
    kind: "lead",
    avitoChatId: input.avitoChatId,
    avitoItemId: input.avitoItemId ?? undefined,
    avitoUserId: input.authorAvitoUserId,
    name: input.authorName ?? null,
    itemUrl: avitoItem?.url ?? undefined,
    lastInboundAt: input.receivedAt.toISOString(),
  } satisfies Record<string, unknown> & TaskAvitoMetadata;

  let task: Task | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const publicId = generatePublicId();
    try {
      task = await prisma.task.create({
        data: {
          publicId,
          boardId,
          columnId,
          categoryId: category?.id ?? null,
          title: title.slice(0, 200),
          description,
          priority: category?.priorityHint ?? "HIGH",
          source: "API",
          externalContact: externalContact as Prisma.InputJsonValue,
        },
      });
      break;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        continue;
      }
      throw err;
    }
  }
  if (!task) throw new Error("avito.createNewLeadTask: failed to allocate publicId");

  await prisma.taskEvent.create({
    data: {
      taskId: task.id,
      kind: "CREATED",
      metadata: {
        source: "avito",
        avitoChatId: input.avitoChatId,
        avitoItemId: input.avitoItemId ?? null,
        moduleSlug,
      },
    },
  });

  // Auto-assign default responsible from the category, if configured.
  if (category?.defaultResponsibleUserId) {
    await prisma.taskAssignee
      .create({
        data: {
          taskId: task.id,
          userId: category.defaultResponsibleUserId,
          role: "RESPONSIBLE",
        },
      })
      .catch(() => {
        // ignore unique-conflict (e.g. retry path)
      });
  }

  return task;
}

function buildTitle(
  avitoItem: { title: string } | null,
  input: RouteInboundInput
): string {
  const author = input.authorName?.trim() || "Клиент Авито";
  const item = avitoItem?.title?.trim();
  return item ? `Авито: ${author} — ${item}` : `Авито: ${author}`;
}

function buildDescription(
  avitoItem: { url: string | null; title: string } | null,
  input: RouteInboundInput
): string {
  const lines: string[] = [];
  if (avitoItem?.title) lines.push(`Объявление: ${avitoItem.title}`);
  if (avitoItem?.url) lines.push(`Ссылка: ${avitoItem.url}`);
  lines.push("");
  lines.push("Первое сообщение:");
  lines.push(input.body.slice(0, 4000));
  return lines.join("\n");
}

async function ensureLeadCategory(
  moduleSlug: string | null
): Promise<TaskCategory | null> {
  const slug = moduleSlug
    ? CATEGORY_SLUG_BY_MODULE[moduleSlug] ?? UNASSIGNED_CATEGORY_SLUG
    : UNASSIGNED_CATEGORY_SLUG;

  const existing = await prisma.taskCategory.findUnique({ where: { slug } });
  if (existing) return existing;

  const name = CATEGORY_NAME_BY_SLUG[slug] ?? "Авито лид";
  return prisma.taskCategory.create({
    data: {
      slug,
      name,
      color: "#10B981",
      priorityHint: "HIGH",
      keywords: [],
    },
  });
}

async function resolveBoardId(
  moduleSlug: string | null,
  category: TaskCategory | null
): Promise<string> {
  if (category?.defaultBoardId) {
    const board = await prisma.taskBoard.findUnique({
      where: { id: category.defaultBoardId },
      select: { id: true, isArchived: true },
    });
    if (board && !board.isArchived) return board.id;
  }

  const targetSlug = moduleSlug ? TASK_BOARD_BY_MODULE[moduleSlug] : null;
  if (targetSlug) {
    const board = await prisma.taskBoard.findUnique({
      where: { slug: targetSlug },
      select: { id: true, isArchived: true },
    });
    if (board && !board.isArchived) return board.id;
  }

  const def = await prisma.taskBoard.findFirst({
    where: { OR: [{ slug: DEFAULT_BOARD_SLUG }, { isDefault: true }], isArchived: false },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  });
  if (def) return def.id;

  // Last resort — create a default board so the system works on a fresh DB.
  const created = await prisma.taskBoard.create({
    data: {
      slug: DEFAULT_BOARD_SLUG,
      name: "Основная доска",
      isDefault: true,
      sortOrder: 0,
    },
  });
  await prisma.taskColumn.create({
    data: { boardId: created.id, name: "Новые", color: "#9CA3AF", sortOrder: 0 },
  });
  return created.id;
}

async function resolveFirstColumnId(boardId: string): Promise<string> {
  const col = await prisma.taskColumn.findFirst({
    where: { boardId },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  });
  if (col) return col.id;
  // Auto-bootstrap a "Новые" column for the board.
  const created = await prisma.taskColumn.create({
    data: { boardId, name: "Новые", color: "#9CA3AF", sortOrder: 0 },
  });
  return created.id;
}
