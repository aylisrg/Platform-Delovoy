import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { apiNotFound, apiServerError } from "@/lib/api-response";
import { prisma } from "@/lib/db";
import {
  getMenuImagePath,
  menuImageContentType,
  MENU_IMAGE_URL_PREFIX,
} from "@/modules/cafe/image-storage";

/**
 * GET /api/cafe/menu/images/[filename] — публичная отдача фото позиции меню.
 * Файл отдаётся только если привязан к позиции в БД (защита от перебора имён).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await params;

    const item = await prisma.menuItem.findFirst({
      where: { imageUrl: `${MENU_IMAGE_URL_PREFIX}${filename}`, deletedAt: null },
      select: { id: true },
    });
    if (!item) return apiNotFound("Файл не найден");

    let buffer: Buffer;
    try {
      buffer = await readFile(getMenuImagePath(filename));
    } catch {
      return apiNotFound("Файл не найден");
    }

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": menuImageContentType(filename),
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return apiServerError();
  }
}
