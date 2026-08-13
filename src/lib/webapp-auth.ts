import { NextRequest } from "next/server";
import { SignJWT, jwtVerify } from "jose";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getUserAdminSections } from "@/lib/permissions";

/**
 * Единый слой аутентификации Telegram Mini App.
 *
 * Подпись и проверка JWT живут только здесь — роуты не собирают секрет сами.
 * Fallback-секрета нет: без NEXTAUTH_SECRET аутентификация отказывает явно
 * (WebAppAuthConfigError → 503 NOT_CONFIGURED в роуте), а не работает на
 * публично известном значении.
 */

export class WebAppAuthConfigError extends Error {
  constructor() {
    super("NEXTAUTH_SECRET is not configured — webapp auth is disabled");
    this.name = "WebAppAuthConfigError";
  }
}

// Ленивая резолюция (не на module-load): сборка и тесты без секрета не должны
// падать на импорте. Минимальная длина отсекает заглушки вида "secret".
function getWebAppJwtSecret(): Uint8Array {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new WebAppAuthConfigError();
  }
  return new TextEncoder().encode(secret);
}

export interface WebAppUser {
  id: string;
  telegramId: string;
  role: string;
}

export interface WebAppStaffContext {
  id: string;
  role: Role;
  sections: string[];
}

export async function signWebAppToken(payload: {
  sub: string;
  telegramId: string;
  role: string;
}): Promise<string> {
  return new SignJWT({
    sub: payload.sub,
    telegramId: payload.telegramId,
    role: payload.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(getWebAppJwtSecret());
}

/**
 * Verify Mini App JWT from Authorization header.
 * Returns the user payload or null if invalid.
 */
export async function verifyWebAppToken(
  request: NextRequest
): Promise<WebAppUser | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);

  try {
    const { payload } = await jwtVerify(token, getWebAppJwtSecret());
    if (!payload.sub || !payload.telegramId) return null;

    return {
      id: payload.sub,
      telegramId: payload.telegramId as string,
      role: (payload.role as string) || "USER",
    };
  } catch {
    // Битый/просроченный токен и незаданный секрет неразличимы для клиента:
    // легитимных токенов без секрета не существует.
    return null;
  }
}

/**
 * Ре-чек прав из БД для staff-роутов (AC-1.5/AC-5.8).
 * Роль из токена в решении не участвует — только `sub`. Понижение роли
 * лишает доступа немедленно, не дожидаясь истечения токена.
 */
export async function loadWebAppStaff(
  request: NextRequest
): Promise<
  | { ok: true; staff: WebAppStaffContext }
  | { ok: false; status: 401 | 403 }
> {
  const tokenUser = await verifyWebAppToken(request);
  if (!tokenUser) return { ok: false, status: 401 };

  const dbUser = await prisma.user.findUnique({
    where: { id: tokenUser.id },
    select: { id: true, role: true, mergedIntoUserId: true },
  });

  if (!dbUser || dbUser.mergedIntoUserId || dbUser.role === "USER") {
    return { ok: false, status: 403 };
  }

  const sections = await getUserAdminSections(dbUser.id);
  return { ok: true, staff: { id: dbUser.id, role: dbUser.role, sections } };
}
