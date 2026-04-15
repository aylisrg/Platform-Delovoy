import { NextRequest, NextResponse } from "next/server";
import { readFile, access } from "fs/promises";
import { apiUnauthorized, apiNotFound, apiForbidden, apiServerError } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { getScreenshotPath } from "@/modules/feedback/file-storage";
import { prisma } from "@/lib/db";

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

/**
 * GET /api/feedback/uploads/[filename] — serve screenshot with auth check
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();

    const { filename } = await params;
    const filePath = getScreenshotPath(filename);

    // Check file exists
    try {
      await access(filePath);
    } catch {
      return apiNotFound("Файл не найден");
    }

    // Find the feedback item by screenshot path to verify access
    const feedback = await prisma.feedbackItem.findFirst({
      where: { screenshotPath: filename },
      select: { userId: true },
    });

    if (!feedback) return apiNotFound("Файл не найден");

    // Access check: author or SUPERADMIN
    if (session.user.role !== "SUPERADMIN" && feedback.userId !== session.user.id) {
      return apiForbidden();
    }

    const buffer = await readFile(filePath);
    const ext = filename.substring(filename.lastIndexOf(".")).toLowerCase();
    const contentType = MIME_MAP[ext] || "application/octet-stream";

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return apiServerError();
  }
}
