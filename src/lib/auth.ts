import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "./db";
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

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma) as never,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/auth/signin",
  },
  providers: [
    // Credentials provider for development/testing
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
      },
      async authorize(credentials) {
        if (!credentials?.email) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
        });

        return user;
      },
    }),
    // Telegram OAuth and Email magic links will be added later
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
      const isAdminRoute = request.nextUrl.pathname.startsWith("/admin");
      const isApiRoute = request.nextUrl.pathname.startsWith("/api");
      const isAuthRoute = request.nextUrl.pathname.startsWith("/api/auth");
      const isHealthRoute = request.nextUrl.pathname.startsWith("/api/health");
      const isPublicApiRoute =
        request.nextUrl.pathname.startsWith("/api/cafe") ||
        request.nextUrl.pathname.startsWith("/api/gazebos") ||
        request.nextUrl.pathname.startsWith("/api/ps-park") ||
        request.nextUrl.pathname.startsWith("/api/parking");

      // Public routes — allow
      if (isAuthRoute || isHealthRoute) return true;

      // Public API GET requests — allow
      if (isPublicApiRoute && request.method === "GET") return true;

      // Admin routes — require MANAGER or SUPERADMIN
      if (isAdminRoute) {
        if (!auth?.user) return false;
        const role = auth.user.role;
        return role === "SUPERADMIN" || role === "MANAGER";
      }

      // Other API routes — require auth
      if (isApiRoute) {
        return !!auth?.user;
      }

      // Public pages — allow
      return true;
    },
  },
});
