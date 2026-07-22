import { writeFile, mkdir, unlink, access } from "fs/promises";
import path from "path";

/**
 * Дисковое хранилище фото позиций меню (паттерн feedback/file-storage.ts).
 * Файлы отдаются публичным роутом GET /api/cafe/menu/images/[filename];
 * MenuItem.imageUrl хранит served-путь.
 */

const UPLOAD_DIR =
  process.env.CAFE_UPLOAD_DIR ||
  (process.env.NODE_ENV === "production"
    ? "/data/uploads/cafe"
    : path.join(process.cwd(), "uploads", "cafe"));

export const MENU_IMAGE_CONSTRAINTS = {
  maxSizeBytes: 5 * 1024 * 1024, // 5 МБ
  allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"] as const,
} as const;

const EXT_BY_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

export const MENU_IMAGE_URL_PREFIX = "/api/cafe/menu/images/";

/**
 * Валидирует и сохраняет фото позиции. Возвращает имя файла (без пути).
 */
export async function saveMenuImage(menuItemId: string, file: File): Promise<string> {
  if (file.size > MENU_IMAGE_CONSTRAINTS.maxSizeBytes) {
    throw new Error("Файл слишком большой (максимум 5 МБ)");
  }

  const mimeType = file.type as (typeof MENU_IMAGE_CONSTRAINTS.allowedMimeTypes)[number];
  if (!MENU_IMAGE_CONSTRAINTS.allowedMimeTypes.includes(mimeType)) {
    throw new Error("Допустимые форматы: PNG, JPG, WEBP");
  }

  const ext = EXT_BY_MIME[file.type] || ".png";
  const filename = `${menuItemId}-${Date.now()}${ext}`;

  await mkdir(UPLOAD_DIR, { recursive: true });

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!validateMagicBytes(buffer, file.type)) {
    throw new Error("Содержимое файла не соответствует формату");
  }

  await writeFile(path.join(UPLOAD_DIR, filename), buffer);
  return filename;
}

/** Полный путь к файлу по имени (basename отсекает path traversal). */
export function getMenuImagePath(filename: string): string {
  return path.join(UPLOAD_DIR, path.basename(filename));
}

export async function deleteMenuImage(filename: string): Promise<void> {
  const filePath = getMenuImagePath(filename);
  try {
    await access(filePath);
    await unlink(filePath);
  } catch {
    // файла нет — удалять нечего
  }
}

/** MIME-заголовок по расширению сохранённого файла (для отдачи). */
export function menuImageContentType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

/** Проверка magic bytes — защита от переименованных файлов. */
function validateMagicBytes(buffer: Buffer, mimeType: string): boolean {
  if (buffer.length < 4) return false;

  switch (mimeType) {
    case "image/png":
      return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
    case "image/jpeg":
      return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    case "image/webp":
      return (
        buffer[0] === 0x52 &&
        buffer[1] === 0x49 &&
        buffer[2] === 0x46 &&
        buffer[3] === 0x46 &&
        buffer.length >= 12 &&
        buffer[8] === 0x57 &&
        buffer[9] === 0x45 &&
        buffer[10] === 0x42 &&
        buffer[11] === 0x50
      );
    default:
      return false;
  }
}
