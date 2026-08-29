import type { NextAuthConfig } from "next-auth";
import type { Role } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      email?: string | null;
      name?: string | null;
      image?: string | null;
      adminSections: string[];
    };
  }

  interface User {
    role: Role;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: Role;
    adminSections: string[];
  }
}

/**
 * Extract admin section slug from pathname.
 * "/admin/cafe" -> "cafe", "/admin/architect/logs" -> "architect"
 */
function getAdminSection(pathname: string): string | null {
  const match = pathname.match(/^\/admin\/([^/]+)/);
  return match ? match[1] : null;
}

// #527: literal first-segment route names under /api/gazebos/<x> и
// /api/ps-park/<x> — нужны, чтобы отличить настоящий resource id (публичный
// GET /api/gazebos/[id]) от литерального имени соседнего route.ts файла
// (bookings, timeline и т.п. — админские, с PII, публичными быть не должны).
const GAZEBOS_RESERVED_SEGMENTS = new Set([
  "book",
  "admin-book",
  "bookings",
  "analytics",
  "availability",
  "health",
  "marketing",
  "settings",
  "timeline",
]);
const PS_PARK_RESERVED_SEGMENTS = new Set([
  "book",
  "bookings",
  "admin-book",
  "active-sessions",
  "analytics",
  "auto-complete",
  "availability",
  "health",
  "session-ending-alert",
  "sessions",
  "settings",
  "shift",
  "timeline",
]);

/** GET /api/gazebos/<id> — публичная карточка ресурса (не литеральный route). */
function isGazeboResourceRoute(pathname: string): boolean {
  const match = pathname.match(/^\/api\/gazebos\/([^/]+)$/);
  return !!match && !GAZEBOS_RESERVED_SEGMENTS.has(match[1]);
}

/** GET /api/ps-park/<id> — публичная карточка стола (не литеральный route). */
function isPsParkResourceRoute(pathname: string): boolean {
  const match = pathname.match(/^\/api\/ps-park\/([^/]+)$/);
  return !!match && !PS_PARK_RESERVED_SEGMENTS.has(match[1]);
}

// Edge-compatible auth config — no DB/Prisma imports.
// Used by middleware only. Full config (with PrismaAdapter) is in auth.ts.
export const authConfig: NextAuthConfig = {
  session: { strategy: "jwt" },
  pages: {
    signIn: "/auth/signin",
    newUser: "/auth/redirect",
    verifyRequest: "/auth/redirect",
  },
  providers: [],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id!;
        token.role = user.role ?? "USER";
        token.adminSections = [];
        // adminSections will be populated by full auth.ts config with DB access
      }
      if (trigger === "update" && token.id) {
        // Will be resolved by full auth.ts config with DB access
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.role = (token.role as Role) ?? "USER";
        session.user.adminSections = (token.adminSections as string[]) ?? [];
      }
      return session;
    },
    async authorized({ auth, request }) {
      const { pathname } = request.nextUrl;

      const isAdminRoute = pathname.startsWith("/admin");
      const isApiRoute = pathname.startsWith("/api");
      const isAuthRoute = pathname.startsWith("/api/auth") || pathname.startsWith("/auth");
      const isHealthRoute = pathname.startsWith("/api/health");
      // #527: раньше здесь были широкие startsWith("/api/gazebos") и т.п. —
      // это открывало АНОНИМНЫЙ GET-доступ ко всем роутам под этими
      // префиксами, включая админские с PII (booking history, timeline,
      // active-sessions, /api/rental/[id] с полной карточкой арендатора).
      // Задумано было только для нескольких настоящих публичных виджетов
      // (доступность слотов, список ресурсов, меню, статичная инфо-страница
      // парковки) — теперь это точный allowlist, а не префикс. Аудит и
      // разбор по каждому роуту — issue #527.
      const isPublicApiRoute =
        pathname === "/api/cafe" ||
        pathname === "/api/cafe/health" ||
        pathname.startsWith("/api/cafe/menu/images/") ||
        pathname === "/api/gazebos" ||
        pathname === "/api/gazebos/availability" ||
        pathname === "/api/gazebos/health" ||
        isGazeboResourceRoute(pathname) ||
        pathname === "/api/ps-park" ||
        pathname === "/api/ps-park/availability" ||
        pathname === "/api/ps-park/health" ||
        isPsParkResourceRoute(pathname) ||
        pathname === "/api/parking" ||
        pathname === "/api/parking/health" ||
        pathname === "/api/rental/health" ||
        pathname === "/api/inventory" ||
        pathname === "/api/inventory/health" ||
        // Phase 5.4 public tasks endpoints (Wave 2 hotfix):
        //   /api/tasks/track/<publicId> — anonymous status tracking after /report
        //   /api/tasks/offices?q=...    — autosuggest used by the public /report form
        // Both are rate-limited by IP in the route handler itself.
        pathname.startsWith("/api/tasks/track") ||
        pathname === "/api/tasks/offices" ||
        // Страница ожидания оплаты поллит /api/payments/{id} анонимно (гостевые
        // чекауты кафе/беседок): cuid платежа — capability-токен, суммы и
        // контакты роут не отдаёт. Trailing slash обязателен: админский список
        // GET /api/payments остаётся за сессией.
        pathname.startsWith("/api/payments/") ||
        // Reconciliation-cron ходит из crontab без сессии; роут сам проверяет
        // CRON_SECRET (timingSafeEqual) и отвечает 401 без него.
        pathname === "/api/cron/payments-reconcile" ||
        // Действующая редакция оферты — метаданные (номер, slug, дата) для
        // формы бронирования. Публично по определению: сам текст лежит на
        // /oferta и открыт всем.
        pathname === "/api/legal/current" ||
        // Управление бронью по ссылке из письма: страница работает без
        // регистрации (ТЗ §8), капабилити-токен сверяется по SHA-256 в самом
        // роуте, чужой и несуществующий неразличимы. Trailing slash обязателен —
        // голого /api/booking не существует, а префикс без него открыл бы
        // будущие роуты под этим именем.
        pathname.startsWith("/api/booking/");
      const isPublicPostRoute =
        pathname === "/api/rental/inquiries" ||
        pathname.startsWith("/api/bot/") ||
        // Guest checkout: booking endpoints accept unauthenticated POSTs when
        // the body carries guestName + guestPhone. The handler enforces the rule.
        pathname === "/api/gazebos/book" ||
        // QR-чекаут кафе: гостевой POST, IP rate-limit внутри роута.
        pathname === "/api/cafe/checkout" ||
        // Вебхук ЮKassa: шлётся серверами провайдера без сессии; роут
        // fail-secure — timingSafeEqual по секрету в URL, 503 без env-секрета.
        pathname.startsWith("/api/payments/yookassa/webhook/") ||
        // Public report form (Phase 5.4) — anonymous submission, IP rate-limited
        // (5/hour per IP) inside the route handler.
        pathname === "/api/tasks/report" ||
        // Отмена, перенос и оплата брони со страницы управления: тот же
        // капабилити-токен в пути, что и у GET (см. isPublicApiRoute).
        pathname.startsWith("/api/booking/");
      // CI-triggered endpoints with their own secret-based auth
      const isCiWebhook = pathname === "/api/admin/release-notify";
      // Owner-decisions sweeper (issue-queue-merge.yml, no session — Bearer
      // OWNER_DECISIONS_SECRET checked in route.ts). Same shape as isCiWebhook
      // above, but the route itself uses GET/POST/PATCH, not just POST.
      const isOwnerDecisionsRoute = pathname === "/api/admin/owner-decisions";
      // Webapp (Mini App) routes use their own JWT — not NextAuth sessions
      const isWebappRoute = pathname.startsWith("/api/webapp/");
      // Bot-internal endpoints use x-bot-token header auth
      const isBotInternalRoute = pathname.startsWith("/api/webapp/link/deep-link");

      if (isAuthRoute || isHealthRoute) return true;
      if (isPublicApiRoute && request.method === "GET") return true;
      if (isPublicPostRoute && request.method === "POST") return true;
      if (isCiWebhook && request.method === "POST") return true;
      if (isOwnerDecisionsRoute) return true;
      // Webapp and bot-internal routes handle their own auth (JWT / x-bot-token)
      if (isWebappRoute || isBotInternalRoute) return true;

      if (isAdminRoute) {
        // #591: next-auth@5.0.0-beta.31's handleAuth() only enforces this
        // callback's decision when it returns a Response — a bare boolean
        // is silently discarded whenever a custom middleware function is
        // passed to auth() (which src/proxy.ts always does, for staging
        // guards). `return false` here used to let every unauthenticated
        // request straight through to the page. Always return a Response
        // for deny paths under /admin/*.
        if (!auth?.user) {
          const signInUrl = request.nextUrl.clone();
          signInUrl.pathname = "/auth/signin";
          signInUrl.searchParams.set("callbackUrl", request.nextUrl.href);
          return Response.redirect(signInUrl);
        }
        const role = auth.user.role;

        // /admin/forbidden is accessible to any authenticated user (error page)
        if (pathname === "/admin/forbidden") return true;

        // SUPERADMIN always has full access
        if (role === "SUPERADMIN") return true;

        // ADMIN and MANAGER need to be checked against their assigned admin sections
        if (role === "ADMIN" || role === "MANAGER") {
          const section = getAdminSection(pathname);
          if (!section) return true; // /admin root — redirect will handle

          const adminSections: string[] = auth.user.adminSections ?? [];
          if (!adminSections.includes(section)) {
            return Response.redirect(
              new URL("/admin/forbidden", request.nextUrl.origin)
            );
          }
          return true;
        }

        // #591: same as above — must be a Response, not a bare boolean.
        return Response.redirect(
          new URL("/admin/forbidden", request.nextUrl.origin)
        ); // USER role — no admin access
      }

      // Admin API routes — check section permissions
      if (isApiRoute && pathname.startsWith("/api/admin")) {
        if (!auth?.user) {
          return Response.json(
            { success: false, error: { code: "UNAUTHORIZED", message: "Необходимо войти в аккаунт" } },
            { status: 401 }
          );
        }
        const role = auth.user.role;
        if (role !== "SUPERADMIN" && role !== "ADMIN" && role !== "MANAGER") {
          return Response.json(
            { success: false, error: { code: "FORBIDDEN", message: "Доступ запрещён" } },
            { status: 403 }
          );
        }
        return true;
      }

      if (isApiRoute) {
        if (!auth?.user) {
          return Response.json(
            { success: false, error: { code: "UNAUTHORIZED", message: "Необходимо войти в аккаунт" } },
            { status: 401 }
          );
        }
        return true;
      }

      return true;
    },
  },
  events: {
    async createUser({ user }) {
      console.log(`[Auth] New user created: ${user.email || user.id}`);
    },
  },
};
