import { prisma } from "@/lib/db";
import { TASKS_MODULE_SLUG, TASKS_FALLBACK_ASSIGNEE_KEY } from "./types";

/**
 * Resolve the default assignee for a new task:
 *   1. If categoryId is provided and the category has defaultAssigneeUserId — use that.
 *   2. Otherwise look up the global fallback assignee stored in
 *      Module.config under slug "tasks" → "fallbackAssigneeUserId".
 *   3. If neither is set — return null (task stays unassigned, visible to admins).
 */
export async function resolveAssignee(
  categoryId: string | null | undefined
): Promise<string | null> {
  if (categoryId) {
    const cat = await prisma.taskCategory.findUnique({
      where: { id: categoryId },
      select: { defaultAssigneeUserId: true, isActive: true },
    });
    if (cat?.isActive && cat.defaultAssigneeUserId) {
      return cat.defaultAssigneeUserId;
    }
  }

  return getGlobalFallbackAssignee();
}

/**
 * Read the global fallback assignee id from Module.config → slug "tasks".
 * Separate export so the settings UI can read/write it without duplicating the key.
 */
export async function getGlobalFallbackAssignee(): Promise<string | null> {
  const mod = await prisma.module.findUnique({
    where: { slug: TASKS_MODULE_SLUG },
    select: { config: true },
  });
  const config = (mod?.config as Record<string, unknown> | null) ?? null;
  const userId = config?.[TASKS_FALLBACK_ASSIGNEE_KEY];
  return typeof userId === "string" && userId.length > 0 ? userId : null;
}

export async function setGlobalFallbackAssignee(
  userId: string | null
): Promise<void> {
  const mod = await prisma.module.findUnique({
    where: { slug: TASKS_MODULE_SLUG },
    select: { id: true, config: true },
  });

  const existing = (mod?.config as Record<string, unknown> | null) ?? {};
  const next = { ...existing, [TASKS_FALLBACK_ASSIGNEE_KEY]: userId };

  if (mod) {
    await prisma.module.update({
      where: { id: mod.id },
      data: { config: next },
    });
  } else {
    await prisma.module.create({
      data: {
        slug: TASKS_MODULE_SLUG,
        name: "Задачи",
        description: "Таск-трекер и жалобы арендаторов",
        isActive: true,
        config: next,
      },
    });
  }
}

/**
 * Pick a category by matching its keywords (case-insensitive substring) against
 * the given text. Returns the first category whose first keyword hits, ordered
 * by TaskCategory.sortOrder then name. Used by inbound email to auto-route.
 */
export async function categorizeByKeywords(
  text: string
): Promise<string | null> {
  if (!text) return null;
  const hay = text.toLowerCase();
  const categories = await prisma.taskCategory.findMany({
    where: { isActive: true },
    select: { id: true, keywords: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  for (const cat of categories) {
    for (const kw of cat.keywords) {
      if (kw && hay.includes(kw.toLowerCase())) {
        return cat.id;
      }
    }
  }
  return null;
}
