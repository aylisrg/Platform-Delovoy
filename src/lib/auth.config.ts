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
      const isPublicApiRoute =
        pathname.startsWith("/api/cafe") ||
        pathname.startsWith("/api/gazebos") ||
        pathname.startsWith("/api/ps-park") ||
        pathname.startsWith("/api/parking") ||
        pathname.startsWith("/api/rental") ||
        pathname === "/api/inventory" ||
        pathname === "/api/inventory/health";
      const isPublicPostRoute =
        pathname === "/api/rental/inquiries" ||
        pathname.startsWith("/api/waitlist") ||
        pathname.startsWith("/api/bot/") ||
        // Guest checkout: booking endpoints accept unauthenticated POSTs when
        // the body carries guestName + guestPhone. The handler enforces the rule.
        pathname === "/api/gazebos/book";
      // CI-triggered endpoints with their own secret-based auth
      const isCiWebhook = pathname === "/api/admin/release-notify";
      // Webapp (Mini App) routes use their own JWT — not NextAuth sessions
      const isWebappRoute = pathname.startsWith("/api/webapp/");
      // Bot-internal endpoints use x-bot-token header auth
      const isBotInternalRoute = pathname.startsWith("/api/webapp/link/deep-link");

      if (isAuthRoute || isHealthRoute) return true;
      if (isPublicApiRoute && request.method === "GET") return true;
      if (isPublicPostRoute && request.method === "POST") return true;
      if (isCiWebhook && request.method === "POST") return true;
      // Webapp and bot-internal routes handle their own auth (JWT / x-bot-token)
      if (isWebappRoute || isBotInternalRoute) return true;

      if (isAdminRoute) {
        if (!auth?.user) return false;
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

        return false; // USER role — no admin access
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
