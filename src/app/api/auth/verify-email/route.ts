import { NextResponse } from "next/server";
import { verifyMagicLinkSchema } from "@/modules/auth/validation";
import {
  verifyMagicLink,
  generateSignInNonce,
} from "@/modules/auth/email-magic-link.service";

/**
 * GET /api/auth/verify-email?token=XXX&email=YYY
 *
 * Validates the magic-link token (DB), generates a one-time signin nonce
 * in Redis, and redirects to /auth/signin?magic=<nonce>. The client then
 * calls signIn("magic-link", { nonce }) — never userId — so a leaked
 * cuid alone cannot grant access.
 */
export async function GET(request: Request) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const { searchParams } = new URL(request.url);

  const parsed = verifyMagicLinkSchema.safeParse({
    token: searchParams.get("token"),
    email: searchParams.get("email"),
  });

  if (!parsed.success) {
    return NextResponse.redirect(
      `${appUrl}/auth/signin?error=invalid-link`
    );
  }

  const { token, email } = parsed.data;

  try {
    const { userId } = await verifyMagicLink(token, email);
    const nonce = await generateSignInNonce(userId);
    return NextResponse.redirect(
      `${appUrl}/auth/signin?magic=${encodeURIComponent(nonce)}`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "";

    if (message === "TOKEN_EXPIRED" || message === "REDIS_UNAVAILABLE") {
      // REDIS_UNAVAILABLE surfaces as "expired" to the user — they retry,
      // and a healthy Redis on the next attempt will work.
      return NextResponse.redirect(
        `${appUrl}/auth/signin?error=link-expired`
      );
    }

    // TOKEN_INVALID or unexpected error
    return NextResponse.redirect(
      `${appUrl}/auth/signin?error=invalid-link`
    );
  }
}
