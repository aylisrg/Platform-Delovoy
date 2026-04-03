import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  matcher: [
    // Match admin routes
    "/admin/:path*",
    // Match API routes (except auth and health)
    "/api/((?!auth|health).*)",
  ],
};
