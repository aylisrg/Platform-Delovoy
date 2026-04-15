import { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const JWT_SECRET = new TextEncoder().encode(
  process.env.NEXTAUTH_SECRET || "webapp-secret"
);

export interface WebAppUser {
  id: string;
  telegramId: string;
  role: string;
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
    const { payload } = await jwtVerify(token, JWT_SECRET);
    if (!payload.sub || !payload.telegramId) return null;

    return {
      id: payload.sub,
      telegramId: payload.telegramId as string,
      role: (payload.role as string) || "USER",
    };
  } catch {
    return null;
  }
}
