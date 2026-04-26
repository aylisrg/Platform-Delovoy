import type { Prisma, TaskBoard, TaskColumn } from "@prisma/client";
import { prisma } from "@/lib/db";
import { TaskValidationError } from "./access";

export async function listBoards(): Promise<(TaskBoard & { columns: TaskColumn[] })[]> {
  return prisma.taskBoard.findMany({
    where: { isArchived: false },
    orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }],
    include: { columns: { orderBy: { sortOrder: "asc" } } },
  });
}

export async function getBoardBySlug(
  slug: string
): Promise<(TaskBoard & { columns: TaskColumn[] }) | null> {
  return prisma.taskBoard.findUnique({
    where: { slug },
    include: { columns: { orderBy: { sortOrder: "asc" } } },
  });
}

export async function createBoard(
  data: {
    slug: string;
    name: string;
    description?: string;
    isDefault?: boolean;
    sortOrder?: number;
  },
  actorUserId: string
): Promise<TaskBoard> {
  if (data.isDefault) {
    await prisma.taskBoard.updateMany({
      where: { isDefault: true },
      data: { isDefault: false },
    });
  }
  const board = await prisma.taskBoard.create({ data });
  await prisma.auditLog.create({
    data: {
      userId: actorUserId,
      action: "task.board.create",
      entity: "TaskBoard",
      entityId: board.id,
      metadata: { slug: board.slug },
    },
  });
  return board;
}

export async function updateBoard(
  id: string,
  data: Partial<{
    name: string;
    description: string | null;
    isDefault: boolean;
    sortOrder: number;
    isArchived: boolean;
  }>,
  actorUserId: string
): Promise<TaskBoard> {
  if (data.isDefault) {
    await prisma.taskBoard.updateMany({
      where: { isDefault: true, NOT: { id } },
      data: { isDefault: false },
    });
  }
  const board = await prisma.taskBoard.update({ where: { id }, data });
  await prisma.auditLog.create({
    data: {
      userId: actorUserId,
      action: "task.board.update",
      entity: "TaskBoard",
      entityId: id,
      metadata: { fields: Object.keys(data) },
    },
  });
  return board;
}

export async function addColumn(
  boardId: string,
  data: {
    name: string;
    color?: string;
    sortOrder?: number;
    isTerminal?: boolean;
    wipLimit?: number | null;
  },
  actorUserId: string
): Promise<TaskColumn> {
  let sortOrder = data.sortOrder;
  if (sortOrder === undefined) {
    const max = await prisma.taskColumn.findFirst({
      where: { boardId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    sortOrder = (max?.sortOrder ?? -1) + 1;
  }
  const column = await prisma.taskColumn.create({
    data: {
      boardId,
      name: data.name,
      color: data.color ?? "#9CA3AF",
      sortOrder,
      isTerminal: data.isTerminal ?? false,
      wipLimit: data.wipLimit ?? null,
    },
  });
  await prisma.auditLog.create({
    data: {
      userId: actorUserId,
      action: "task.column.create",
      entity: "TaskColumn",
      entityId: column.id,
      metadata: { boardId, name: column.name },
    },
  });
  return column;
}

export async function updateColumn(
  id: string,
  data: Partial<{
    name: string;
    color: string;
    sortOrder: number;
    isTerminal: boolean;
    wipLimit: number | null;
  }>,
  actorUserId: string
): Promise<TaskColumn> {
  const column = await prisma.taskColumn.update({ where: { id }, data });
  await prisma.auditLog.create({
    data: {
      userId: actorUserId,
      action: "task.column.update",
      entity: "TaskColumn",
      entityId: id,
      metadata: { fields: Object.keys(data) },
    },
  });
  return column;
}

export async function deleteColumn(
  id: string,
  actorUserId: string
): Promise<void> {
  const column = await prisma.taskColumn.findUnique({
    where: { id },
    include: { _count: { select: { tasks: true } } },
  });
  if (!column) throw new TaskValidationError("NOT_FOUND", "Колонка не найдена");
  if (column._count.tasks > 0) {
    throw new TaskValidationError(
      "COLUMN_NOT_EMPTY",
      "Нельзя удалить колонку с задачами"
    );
  }
  const totalCols = await prisma.taskColumn.count({ where: { boardId: column.boardId } });
  if (totalCols <= 1) {
    throw new TaskValidationError("LAST_COLUMN", "Нельзя удалить единственную колонку");
  }
  await prisma.taskColumn.delete({ where: { id } });
  await prisma.auditLog.create({
    data: {
      userId: actorUserId,
      action: "task.column.delete",
      entity: "TaskColumn",
      entityId: id,
      metadata: { boardId: column.boardId, name: column.name },
    },
  });
}

export async function reorderColumns(
  boardId: string,
  ordered: { id: string; sortOrder: number }[],
  actorUserId: string
): Promise<void> {
  // Two-step to avoid violating @@unique([boardId, sortOrder]).
  // Step 1: move all to negative offset to free the range.
  await prisma.$transaction([
    ...ordered.map((c) =>
      prisma.taskColumn.update({
        where: { id: c.id },
        data: { sortOrder: -1000 - c.sortOrder },
      })
    ),
    ...ordered.map((c) =>
      prisma.taskColumn.update({
        where: { id: c.id },
        data: { sortOrder: c.sortOrder },
      })
    ),
  ]);
  await prisma.auditLog.create({
    data: {
      userId: actorUserId,
      action: "task.column.reorder",
      entity: "TaskBoard",
      entityId: boardId,
      metadata: { count: ordered.length },
    },
  });
}

export async function listCategories() {
  return prisma.taskCategory.findMany({
    where: { isArchived: false },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function createCategory(
  data: {
    slug: string;
    name: string;
    description?: string;
    color?: string;
    defaultBoardId?: string | null;
    defaultResponsibleUserId?: string | null;
    keywords?: string[];
    priorityHint?: import("@prisma/client").TaskPriority;
    sortOrder?: number;
  },
  actorUserId: string
) {
  const cat = await prisma.taskCategory.create({
    data: {
      slug: data.slug,
      name: data.name,
      description: data.description,
      color: data.color ?? "#9CA3AF",
      defaultBoardId: data.defaultBoardId ?? null,
      defaultResponsibleUserId: data.defaultResponsibleUserId ?? null,
      keywords: data.keywords ?? [],
      priorityHint: data.priorityHint ?? "NONE",
      sortOrder: data.sortOrder ?? 0,
    },
  });
  await prisma.auditLog.create({
    data: {
      userId: actorUserId,
      action: "task.category.create",
      entity: "TaskCategory",
      entityId: cat.id,
      metadata: { slug: cat.slug },
    },
  });
  return cat;
}

export async function updateCategory(
  id: string,
  data: Prisma.TaskCategoryUpdateInput,
  actorUserId: string
) {
  const cat = await prisma.taskCategory.update({ where: { id }, data });
  await prisma.auditLog.create({
    data: {
      userId: actorUserId,
      action: "task.category.update",
      entity: "TaskCategory",
      entityId: id,
      metadata: {},
    },
  });
  return cat;
}

export async function archiveCategory(id: string, actorUserId: string) {
  await prisma.taskCategory.update({
    where: { id },
    data: { isArchived: true },
  });
  await prisma.auditLog.create({
    data: {
      userId: actorUserId,
      action: "task.category.archive",
      entity: "TaskCategory",
      entityId: id,
      metadata: {},
    },
  });
}
