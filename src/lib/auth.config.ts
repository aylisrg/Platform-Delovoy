import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
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
  providers: [
    // Stub — real authorize with DB access lives in auth.ts
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
      },
      async authorize() {
        return null;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
      }
      return session;
    },
    async authorized({ auth, request }) {
      const { pathname } = request.nextUrl;

      const isAdminRoute = pathname.startsWith("/admin");
      const isApiRoute = pathname.startsWith("/api");
      const isAuthRoute = pathname.startsWith("/api/auth");
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
        return !!auth?.user;
      }

      return true;
    },
  },
};
