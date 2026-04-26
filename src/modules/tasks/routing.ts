import { prisma } from "@/lib/db";
import type { TaskCategory, TaskPriority } from "@prisma/client";

/**
 * Find the best-matching category for free-form text via keyword substring
 * match (case-insensitive). Returns the first category whose any keyword is
 * present, or null. Categories iterated in `sortOrder` ascending.
 */
export function categorizeByKeywords(
  text: string,
  categories: Pick<TaskCategory, "id" | "slug" | "keywords" | "sortOrder">[]
): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  const sorted = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const cat of sorted) {
    for (const kw of cat.keywords) {
      if (kw && lower.includes(kw.toLowerCase())) return cat.id;
    }
  }
  return null;
}

export async function resolveDefaultResponsible(
  categoryId: string | null
): Promise<{ userId: string | null; priorityHint: TaskPriority | null }> {
  if (!categoryId) return { userId: null, priorityHint: null };
  const cat = await prisma.taskCategory.findUnique({
    where: { id: categoryId },
    select: { defaultResponsibleUserId: true, priorityHint: true },
  });
  return {
    userId: cat?.defaultResponsibleUserId ?? null,
    priorityHint: cat?.priorityHint ?? null,
  };
}

export async function resolveTargetBoardAndColumn(
  preferredBoardId: string | undefined,
  preferredColumnId: string | undefined,
  categoryId: string | null
): Promise<{ boardId: string; columnId: string }> {
  // 1) explicit preferred boardId+columnId
  if (preferredBoardId && preferredColumnId) {
    const col = await prisma.taskColumn.findUnique({
      where: { id: preferredColumnId },
      select: { id: true, boardId: true },
    });
    if (col && col.boardId === preferredBoardId) {
      return { boardId: col.boardId, columnId: col.id };
    }
  }
  // 2) board from category default → first column of that board
  let boardId = preferredBoardId ?? null;
  if (!boardId && categoryId) {
    const cat = await prisma.taskCategory.findUnique({
      where: { id: categoryId },
      select: { defaultBoardId: true },
    });
    if (cat?.defaultBoardId) boardId = cat.defaultBoardId;
  }
  // 3) default board
  if (!boardId) {
    const def = await prisma.taskBoard.findFirst({
      where: { isDefault: true, isArchived: false },
      orderBy: { sortOrder: "asc" },
      select: { id: true },
    });
    if (!def) {
      const any = await prisma.taskBoard.findFirst({
        where: { isArchived: false },
        orderBy: { sortOrder: "asc" },
        select: { id: true },
      });
      if (!any) throw new Error("No active TaskBoard configured");
      boardId = any.id;
    } else {
      boardId = def.id;
    }
  }
  // first column of selected board
  const firstColumn = await prisma.taskColumn.findFirst({
    where: { boardId },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  });
  if (!firstColumn) throw new Error("Board has no columns");
  return { boardId, columnId: firstColumn.id };
}
