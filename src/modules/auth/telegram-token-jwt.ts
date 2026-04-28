/**
 * Shared constants + verifier for the one-time JWT minted at
 * /api/auth/telegram/status and consumed by the `telegram-token`
 * NextAuth Credentials provider.
 *
 * Kept as a small, env-free module so route handlers and the auth
 * config can both depend on it without circular imports.
 */
import { jwtVerify } from "jose";

export const JWT_AUDIENCE = "delovoy-telegram-token";
export const JWT_ISSUER = "delovoy-platform";
export const JWT_TYPE = "tg-auth";

export type TelegramTokenJwtPayload = {
  sub: string; // userId
  jti: string; // dedup id
  type: typeof JWT_TYPE;
};

/**
 * Verify the one-time JWT. Returns the decoded payload on success;
 * null when the signature, audience, issuer, expiry or `type` claim
 * doesn't match. Caller is responsible for jti dedup (Redis SETNX).
 */
export async function verifyTelegramTokenJwt(
  token: string,
  secret: string
): Promise<TelegramTokenJwtPayload | null> {
  if (!token || typeof token !== "string" || !secret) return null;
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(secret),
      {
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      }
    );
    if (payload.type !== JWT_TYPE) return null;
    if (typeof payload.sub !== "string" || payload.sub.length === 0) return null;
    if (typeof payload.jti !== "string" || payload.jti.length === 0) return null;
    return {
      sub: payload.sub,
      jti: payload.jti,
      type: JWT_TYPE,
    };
  } catch {
    return null;
  }
}
