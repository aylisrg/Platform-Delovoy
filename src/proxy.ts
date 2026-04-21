import NextAuth from "next-auth";
import { NextResponse, type NextRequest } from "next/server";
import { authConfig } from "@/lib/auth.config";
import { enforceStagingBasicAuth, isStaging } from "@/lib/staging-guard";

const { auth } = NextAuth(authConfig);

// Wrap the NextAuth middleware so that on staging we first demand a valid
// Basic Auth header (второй слой защиты от индексации и случайных заходов).
// На проде это no-op — isStaging() === false.
export default auth(async (request) => {
  const stagingChallenge = enforceStagingBasicAuth(request as unknown as NextRequest);
  if (stagingChallenge) return stagingChallenge;
  return NextResponse.next();
});

// Matcher: на проде — старое поведение (admin + api). На staging расширяем на всё
// кроме статики и health, чтобы Basic Auth закрыл весь сайт целиком.
export const config = {
  matcher: isStaging()
    ? [
        "/((?!_next/static|_next/image|favicon\\.ico|api/health).*)",
      ]
    : [
        "/admin/:path*",
        "/api/((?!auth|health).*)",
      ],
};
