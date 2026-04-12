import { NextResponse } from "next/server";
import { verifyMagicLinkSchema } from "@/modules/auth/validation";
import { verifyMagicLink } from "@/modules/auth/email-magic-link.service";

/**
 * GET /api/auth/verify-email?token=XXX&email=YYY
 *
 * Validates the magic link token and redirects to the sign-in page
 * with userId param so the client can complete the session via
 * signIn("magic-link", { userId }).
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
    // Redirect to signin page with userId; the page auto-signs in via
    // the "magic-link" Credentials provider
    return NextResponse.redirect(
      `${appUrl}/auth/signin?magic=${encodeURIComponent(userId)}`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "";

    if (message === "TOKEN_EXPIRED") {
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
