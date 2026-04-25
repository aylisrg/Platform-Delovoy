import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { consumeSignInNonce } from "./email-magic-link.service";

/**
 * authorize() implementation for the "magic-link" Credentials provider.
 *
 * Extracted from src/lib/auth.ts so it can be unit-tested without
 * spinning up the full NextAuth + PrismaAdapter pipeline.
 *
 * Returns the user when the nonce is a fresh, unused, Redis-backed
 * signin nonce. Returns null in every other case (missing nonce, wrong
 * type, unknown / consumed nonce, Redis down, user record missing).
 */
export async function authorizeMagicLinkNonce(
  credentials: Partial<Record<"nonce", unknown>> | undefined
): Promise<User | null> {
  const nonce = credentials?.nonce;
  if (!nonce || typeof nonce !== "string") return null;

  const userId = await consumeSignInNonce(nonce);
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  return user;
}
