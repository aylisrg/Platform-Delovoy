import { writeFile, mkdir, unlink, access } from "fs/promises";
import path from "path";
import { SCREENSHOT_CONSTRAINTS } from "./validation";

const UPLOAD_DIR =
  process.env.FEEDBACK_UPLOAD_DIR ||
  (process.env.NODE_ENV === "production"
    ? "/data/uploads/feedback"
    : path.join(process.cwd(), "uploads", "feedback"));

/**
 * Validate and save a screenshot file.
 * Returns the relative filename (not full path).
 */
export async function saveScreenshot(
  feedbackId: string,
  file: File
): Promise<string> {
  // Validate size
  if (file.size > SCREENSHOT_CONSTRAINTS.maxSizeBytes) {
    throw new Error("Файл слишком большой (максимум 5 МБ)");
  }

  // Validate MIME type
  const mimeType = file.type as (typeof SCREENSHOT_CONSTRAINTS.allowedMimeTypes)[number];
  if (
    !SCREENSHOT_CONSTRAINTS.allowedMimeTypes.includes(mimeType)
  ) {
    throw new Error("Допустимые форматы: PNG, JPG, WEBP");
  }

  // Determine extension from MIME
  const extMap: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
  };
  const ext = extMap[file.type] || ".png";
  const filename = `${feedbackId}-${Date.now()}${ext}`;

  // Ensure directory exists
  await mkdir(UPLOAD_DIR, { recursive: true });

  // Write file
  const buffer = Buffer.from(await file.arrayBuffer());

  // Validate magic bytes (basic check)
  if (!validateMagicBytes(buffer, file.type)) {
    throw new Error("Содержимое файла не соответствует формату");
  }

  const filePath = path.join(UPLOAD_DIR, filename);
  await writeFile(filePath, buffer);

  return filename;
}

/**
 * Get the full file path for a screenshot filename.
 */
export function getScreenshotPath(filename: string): string {
  // Prevent path traversal
  const sanitized = path.basename(filename);
  return path.join(UPLOAD_DIR, sanitized);
}

/**
 * Delete a screenshot file.
 */
export async function deleteScreenshot(filename: string): Promise<void> {
  const filePath = getScreenshotPath(filename);
  try {
    await access(filePath);
    await unlink(filePath);
  } catch {
    // File doesn't exist — nothing to delete
  }
}

/**
 * Validate magic bytes to prevent disguised file uploads.
 */
function validateMagicBytes(buffer: Buffer, mimeType: string): boolean {
  if (buffer.length < 4) return false;

  switch (mimeType) {
    case "image/png":
      // PNG: 89 50 4E 47
      return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
    case "image/jpeg":
      // JPEG: FF D8 FF
      return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    case "image/webp":
      // WEBP: 52 49 46 46 ... 57 45 42 50
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
