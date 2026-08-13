import { NextRequest } from "next/server";
import { apiResponse, apiError, apiServerError } from "@/lib/api-response";
import { validateInitData } from "@/lib/telegram-webapp";
import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";
import { rateLimit } from "@/lib/rate-limit";
import { signWebAppToken, WebAppAuthConfigError } from "@/lib/webapp-auth";
import { getWebAppCapabilities } from "@/lib/webapp/capabilities";
import { initDataAuthSchema } from "@/lib/webapp/validation";

/**
 * POST /api/webapp/auth — authenticate Telegram Mini App user.
 *
 * Accepts initData from Telegram WebApp, validates the signature,
 * finds or creates the user, and returns a JWT for subsequent API calls
 * plus `capabilities` — снимок прав для рендера ролевой навигации (AC-1.6).
 * Staff-роуты этому снимку не доверяют и перечитывают права из БД.
 */
export async function POST(request: NextRequest) {
  try {
    // Rate limit до любой криптографии: ключ по доверенному IP (AC-1.7).
    const limited = await rateLimit(request, "public");
    if (limited) return limited;

    const body = await request.json().catch(() => null);
    const parsed = initDataAuthSchema.safeParse(body);
    if (!parsed.success) {
      return apiError("VALIDATION_ERROR", "initData is required", 422);
    }

    // Validate Telegram signature (timing-safe, auth_date ≤ 1h)
    const initData = validateInitData(parsed.data.initData);
    if (!initData) {
      return apiError("UNAUTHORIZED", "Invalid or expired initData", 401);
    }

    const { user: tgUser } = initData;
    const telegramId = String(tgUser.id);
    const name =
      [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ") ||
      tgUser.username ||
      "Telegram User";

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

    const token = await signWebAppToken({
      sub: user.id,
      telegramId,
      role: user.role,
    });

    const capabilities = await getWebAppCapabilities(user);

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
      capabilities,
    });
  } catch (error) {
    if (error instanceof WebAppAuthConfigError) {
      // Явный отказ вместо тихой работы на публично известном fallback-секрете (AC-1.8)
      return apiError(
        "NOT_CONFIGURED",
        "Аутентификация Mini App не настроена",
        503
      );
    }
    console.error("[WebApp Auth] Error:", error);
    return apiServerError();
  }
}
