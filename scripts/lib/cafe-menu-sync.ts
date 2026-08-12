/**
 * Синхронизация меню кафе в БД с настенным прайсом (`CAFE_MENU`).
 *
 * Зачем отдельно от сида: seedCore намеренно НЕ перезаписывает цены
 * существующих позиций (менеджер правит их из админки), поэтому наполненную БД
 * он исправить не может. Этот код может — запускается разово после смены
 * прайса через scripts/update-cafe-menu.ts.
 *
 * Идемпотентно: повторный запуск = то же состояние.
 */
import type { PrismaClient } from "@prisma/client";
import { CAFE_MENU } from "./cafe-menu";

export const MODULE_SLUG = "cafe";

export type SyncAction =
  | "создана"
  | "обновлена"
  | "без изменений"
  | "скрыт дубль"
  | "скрыта";

export type SyncChange = { action: SyncAction; detail: string };

type MenuRow = {
  id: string;
  name: string;
  category: string;
  price: unknown;
  isAvailable: boolean;
  autoDisabledByStock: boolean;
  deletedAt: Date | null;
};

/**
 * Приводит меню кафе к прайсу:
 *   - позиция с прайса есть в БД → обновляет категорию, описание, цену, порядок;
 *   - позиции нет → создаёт;
 *   - позиция была soft-deleted, но вернулась на прайс → восстанавливает;
 *   - позиция в БД, которой нет на прайсе → СКРЫВАЕТ (isAvailable=false),
 *     не удаляет: снимается одним кликом в админке, если это живое блюдо.
 *
 * Наличие по остаткам не трогает: позицию, скрытую инвентарём
 * (`autoDisabledByStock`), оставляет скрытой — иначе на витрину вернётся товар
 * с нулевым остатком, а авто-возврат из inventory больше не сработает (он
 * ищет строки именно с этим флагом).
 */
export async function syncCafeMenu(
  prisma: PrismaClient,
  opts: { dryRun?: boolean } = {},
): Promise<SyncChange[]> {
  const dryRun = opts.dryRun ?? false;

  const existing = (await prisma.menuItem.findMany({
    where: { moduleSlug: MODULE_SLUG },
  })) as unknown as MenuRow[];

  // MenuItem не имеет unique по имени — дубли технически возможны. Каноничной
  // считаем первую живую строку: у неё уже есть история заказов и фото.
  const byName = new Map<string, MenuRow[]>();
  for (const row of existing) {
    const rows = byName.get(row.name) ?? [];
    rows.push(row);
    byName.set(row.name, rows);
  }
  for (const rows of byName.values()) {
    rows.sort((a, b) => Number(Boolean(a.deletedAt)) - Number(Boolean(b.deletedAt)));
  }

  const changes: SyncChange[] = [];
  const seenIds = new Set<string>();

  for (const item of CAFE_MENU) {
    const [canonical, ...duplicates] = byName.get(item.name) ?? [];

    if (!canonical) {
      if (!dryRun) {
        await prisma.menuItem.create({
          // isAvailable явно: позиция с прайса сразу на витрине, без опоры
          // на дефолт схемы.
          data: { ...item, moduleSlug: MODULE_SLUG, isAvailable: true },
        });
      }
      changes.push({
        action: "создана",
        detail: `${item.category} · ${item.name} — ${item.price} ₽`,
      });
      continue;
    }

    seenIds.add(canonical.id);
    for (const dup of duplicates) seenIds.add(dup.id);

    // Скрытую по остаткам позицию оставляем скрытой — вернёт inventory.
    const restoreAvailability = !canonical.autoDisabledByStock;
    const wasHidden = !canonical.isAvailable;
    const priceChanged = Number(canonical.price) !== item.price;
    const categoryChanged = canonical.category !== item.category;
    const wasDeleted = Boolean(canonical.deletedAt);

    if (!dryRun) {
      await prisma.menuItem.update({
        where: { id: canonical.id },
        data: {
          category: item.category,
          description: item.description ?? null,
          price: item.price,
          sortOrder: item.sortOrder,
          deletedAt: null,
          ...(restoreAvailability && { isAvailable: true }),
        },
      });
    }

    const restored = wasHidden && restoreAvailability;
    const notes = [
      priceChanged ? `${Number(canonical.price)} → ${item.price} ₽` : `${item.price} ₽`,
      categoryChanged ? `категория ${canonical.category} → ${item.category}` : null,
      wasDeleted ? "восстановлена из удалённых" : null,
      restored ? "снова на витрине" : null,
      wasHidden && !restoreAvailability ? "оставлена скрытой (нет остатка)" : null,
    ].filter(Boolean);

    changes.push({
      action:
        priceChanged || categoryChanged || wasDeleted || restored
          ? "обновлена"
          : "без изменений",
      detail: `${item.category} · ${item.name} — ${notes.join(", ")}`,
    });

    for (const dup of duplicates) {
      // Уже невидимые тёзки (скрытые или удалённые) трогать незачем.
      if (!dup.isAvailable || dup.deletedAt) continue;
      if (!dryRun) {
        await prisma.menuItem.update({
          where: { id: dup.id },
          data: { isAvailable: false },
        });
      }
      changes.push({
        action: "скрыт дубль",
        detail: `${dup.category} · ${dup.name} (id ${dup.id})`,
      });
    }
  }

  // Позиции, которых нет на прайсе: скрываем, но не удаляем.
  const offBoard = existing.filter(
    (row) => !seenIds.has(row.id) && !row.deletedAt && row.isAvailable,
  );
  for (const row of offBoard) {
    if (!dryRun) {
      await prisma.menuItem.update({
        where: { id: row.id },
        data: { isAvailable: false },
      });
    }
    changes.push({
      action: "скрыта",
      detail: `${row.category} · ${row.name} — нет на прайсе`,
    });
  }

  return changes;
}
