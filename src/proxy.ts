import NextAuth from "next-auth";
import { NextResponse, type NextRequest } from "next/server";
import { authConfig } from "@/lib/auth.config";
import {
  enforceStagingBasicAuth,
  enforceStagingRoleCheck,
} from "@/lib/staging-guard";

const { auth } = NextAuth(authConfig);

// Wrap the NextAuth middleware so that on staging we enforce two additional
// layers on top of auth.config's `authorized()` callback:
//   1. Basic Auth header (Nginx + app-level) — второй барьер от crawlers.
//   2. SUPERADMIN-only gate для mutating endpoints (ADR §9.1 / Task #1 DoD).
// На проде обе проверки — no-op (isStaging() === false).
export default auth(async (request) => {
  const nextReq = request as unknown as NextRequest;

  const stagingChallenge = enforceStagingBasicAuth(nextReq);
  if (stagingChallenge) return stagingChallenge;

  // `request.auth` is attached by the NextAuth `auth()` wrapper.
  const session = (request as unknown as { auth: unknown }).auth as
    | { user?: { role?: string | null } | null }
    | null
    | undefined;
  const roleBlock = enforceStagingRoleCheck(nextReq, session);
  if (roleBlock) return roleBlock;

  return NextResponse.next();
});

// Matcher должен быть статическим на уровне компиляции (требование Next.js).
// Поэтому на ПРОДЕ мы расширенный matcher всё равно не трогаем — но на staging
// перекрытие: `enforceStagingBasicAuth` внутри handler тоже проверит pathname
// (для staging) и выдаст 401 на всех mutating routes, которые проходят через
// middleware. Публичные страницы (/, /cafe, /gazebos ...) уже покрыты
// Nginx Basic Auth как первым слоем защиты — это достаточно по ADR §9.1.
export const config = {
  matcher: [
    "/admin/:path*",
    "/api/((?!auth|health).*)",
  ],
};
