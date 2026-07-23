import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiNotFound,
  apiUnauthorized,
  apiServerError,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import { prisma } from "@/lib/db";
import { getMenuItem } from "@/modules/cafe/service";
import {
  saveMenuImage,
  deleteMenuImage,
  MENU_IMAGE_URL_PREFIX,
} from "@/modules/cafe/image-storage";

/**
 * POST /api/cafe/menu/:id/image — загрузка фото позиции (multipart, поле file).
 * Старый файл удаляется; MenuItem.imageUrl получает served-путь.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const denied = await requireAdminSection(session, "cafe");
    if (denied) return denied;

    const { id } = await params;
    const item = await getMenuItem(id);
    if (!item || item.deletedAt) return apiNotFound("Позиция меню не найдена");

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return apiError("VALIDATION_ERROR", "Приложите файл изображения", 422);
    }

    let filename: string;
    try {
      filename = await saveMenuImage(id, file);
    } catch (err) {
      return apiError(
        "VALIDATION_ERROR",
        err instanceof Error ? err.message : "Не удалось сохранить файл",
        422
      );
    }

    // Прежний загруженный файл больше не нужен (внешние URL не трогаем).
    if (item.imageUrl?.startsWith(MENU_IMAGE_URL_PREFIX)) {
      await deleteMenuImage(item.imageUrl.slice(MENU_IMAGE_URL_PREFIX.length));
    }

    const imageUrl = `${MENU_IMAGE_URL_PREFIX}${filename}`;
    const updated = await prisma.menuItem.update({
      where: { id },
      data: { imageUrl },
    });

    await logAudit(session.user.id, "menu_item.image_upload", "MenuItem", id, {
      filename,
    });

    return apiResponse({ id: updated.id, imageUrl });
  } catch {
    return apiServerError();
  }
}
