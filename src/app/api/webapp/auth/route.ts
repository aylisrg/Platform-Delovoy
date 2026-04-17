import { NextRequest } from "next/server";
import { apiResponse, apiError, apiServerError } from "@/lib/api-response";
import { validateInitData } from "@/lib/telegram-webapp";
import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";
import { SignJWT } from "jose";

const JWT_SECRET = new TextEncoder().encode(
  process.env.NEXTAUTH_SECRET || "webapp-secret"
);

/**
 * POST /api/webapp/auth — authenticate Telegram Mini App user.
 *
 * Accepts initData from Telegram WebApp, validates the signature,
 * finds or creates the user, and returns a JWT for subsequent API calls.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { initData } = body;

    if (!initData || typeof initData !== "string") {
      return apiError("VALIDATION_ERROR", "initData is required", 422);
    }

    // Validate Telegram signature
    const parsed = validateInitData(initData);
    if (!parsed) {
      return apiError("UNAUTHORIZED", "Invalid or expired initData", 401);
    }

    const { user: tgUser } = parsed;
    const telegramId = String(tgUser.id);
    const name = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ") || tgUser.username || "Telegram User";

    // Find or create user
    let isNewUser = false;
    let user = await prisma.user.findUnique({
      where: { telegramId },
      select: { id: true, name: true, role: true, image: true, telegramId: true },
    });

    if (!user) {
      isNewUser = true;
      user = await prisma.user.create({
        data: {
          telegramId,
          name,
          image: tgUser.photo_url || null,
          role: "USER",
        },
        select: { id: true, name: true, role: true, image: true, telegramId: true },
      });
    } else if (user.name !== name) {
      user = await prisma.user.update({
        where: { telegramId },
        data: { name },
        select: { id: true, name: true, role: true, image: true, telegramId: true },
      });
    }

    // Sign JWT (valid 24h)
    const token = await new SignJWT({
      sub: user.id,
      telegramId,
      role: user.role,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("24h")
      .sign(JWT_SECRET);

    // Check if linking was previously skipped
    const skipped = await redis
      .get(`tg-link:skipped:${telegramId}`)
      .catch(() => null);
    const needsLinking = isNewUser && !skipped;

    return apiResponse({
      token,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        image: user.image,
        telegramId: user.telegramId,
      },
      needsLinking,
    });
  } catch (error) {
    console.error("[WebApp Auth] Error:", error);
    return apiServerError();
  }
}
