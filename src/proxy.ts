import NextAuth from "next-auth";
import { NextResponse, type NextRequest } from "next/server";
import { authConfig } from "@/lib/auth.config";
import { enforceStagingBasicAuth } from "@/lib/staging-guard";

const { auth } = NextAuth(authConfig);

// Wrap the NextAuth middleware so that on staging we first demand a valid
// Basic Auth header (второй слой защиты от индексации и случайных заходов).
// На проде `enforceStagingBasicAuth` — no-op.
export default auth(async (request) => {
  const stagingChallenge = enforceStagingBasicAuth(request as unknown as NextRequest);
  if (stagingChallenge) return stagingChallenge;
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
