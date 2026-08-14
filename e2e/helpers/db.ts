import { PrismaClient } from "@prisma/client";

/**
 * Direct DB access for E2E assertions — flows must be verified against a
 * real write, not just UI feedback (issue #572 AC). Separate from the app's
 * own `src/lib/db.ts` singleton: e2e/ runs outside the Next.js module graph.
 */
export const prisma = new PrismaClient();
