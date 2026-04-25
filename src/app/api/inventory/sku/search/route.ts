import { NextRequest } from "next/server";
import {
  apiResponse,
  apiUnauthorized,
  apiForbidden,
  apiServerError,
  apiValidationError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { searchSkus, type SkuSearchCandidate } from "@/lib/sku-search";
import { rateLimit } from "@/lib/rate-limit";
import { redis, redisAvailable } from "@/lib/redis";

const CACHE_TTL_SECONDS = 60;
const CACHE_PREFIX = "sku-search:";

/**
 * GET /api/inventory/sku/search?q=<query>
 * Fuzzy SKU search with transliteration.
 * Returns up to 6 candidates ranked by similarity.
 *
 * - Rate-limited (authenticated tier) — endpoint is fired on every debounced keystroke.
 * - Cached in Redis for 60s by lowercased query — bursts of identical typing hit cache, not DB.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return apiUnauthorized();
    const { role } = session.user;
    if (role !== "SUPERADMIN" && role !== "ADMIN" && role !== "MANAGER") return apiForbidden();

    const rl = await rateLimit(request, "authenticated");
    if (rl) return rl;

    const q = new URL(request.url).searchParams.get("q") ?? "";
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      return apiValidationError("Запрос должен содержать минимум 2 символа");
    }

    const cacheKey = `${CACHE_PREFIX}${trimmed.toLowerCase()}`;

    // Try cache first — degrade gracefully if Redis is down.
    if (redisAvailable) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached) as SkuSearchCandidate[];
          return apiResponse(parsed, { total: parsed.length });
        }
      } catch {
        // Ignore cache read failure — fall through to DB.
      }
    }

    const skus = await prisma.inventorySku.findMany({
      where: { isActive: true },
      select: { id: true, name: true, category: true, unit: true, stockQuantity: true },
    });

    const results = searchSkus(
      trimmed,
      skus.map((s) => ({ ...s, stockQuantity: Number(s.stockQuantity) }))
    );

    if (redisAvailable) {
      try {
        await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(results));
      } catch {
        // Ignore cache write failure — response already computed.
      }
    }

    return apiResponse(results, { total: results.length });
  } catch {
    return apiServerError();
  }
}
