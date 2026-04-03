import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

const { auth } = NextAuth(authConfig);

export default auth;

export const config = {
  matcher: [
    // Match admin routes
    "/admin/:path*",
    // Match API routes (except auth and health)
    "/api/((?!auth|health).*)",
  ],
};
