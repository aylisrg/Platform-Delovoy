export { auth as middleware } from "@/lib/auth";

export const config = {
  matcher: [
    // Match admin routes
    "/admin/:path*",
    // Match API routes (except auth and health)
    "/api/((?!auth|health).*)",
  ],
};
