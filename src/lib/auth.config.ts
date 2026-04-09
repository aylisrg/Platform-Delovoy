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
    };
  }

  interface User {
    role: Role;
  }
}

// Edge-compatible auth config — no DB/Prisma imports.
// Used by middleware only. Full config (with PrismaAdapter) is in auth.ts.
export const authConfig: NextAuthConfig = {
  session: { strategy: "jwt" },
  pages: {
    signIn: "/auth/signin",
  },
  providers: [],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id;
        token.role = user.role ?? "USER";
      }
      // Refresh role from DB on session update
      if (trigger === "update" && token.id) {
        // Will be resolved by full auth.ts config with DB access
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.role = (token.role as Role) ?? "USER";
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
        pathname.startsWith("/api/parking");

      if (isAuthRoute || isHealthRoute) return true;
      if (isPublicApiRoute && request.method === "GET") return true;

      if (isAdminRoute) {
        if (!auth?.user) return false;
        const role = auth.user.role;
        return role === "SUPERADMIN" || role === "MANAGER";
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
      // New OAuth users automatically get USER role — handled by DB default
      // This event fires for Google/Yandex OAuth first-time sign-ins
      console.log(`[Auth] New user created: ${user.email || user.id}`);
    },
  },
};
