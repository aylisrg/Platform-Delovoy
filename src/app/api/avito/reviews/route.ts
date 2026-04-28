import { NextRequest } from "next/server";
import {
  apiForbidden,
  apiResponse,
  apiServerError,
  apiUnauthorized,
  apiValidationError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getUserModules, hasAdminSectionAccess } from "@/lib/permissions";
import { AvitoReviewsQuerySchema } from "@/lib/avito/validation";

export const dynamic = "force-dynamic";

/**
 * GET /api/avito/reviews — list Avito reviews with filters.
 * RBAC:
 *  - SUPERADMIN: all reviews.
 *  - ADMIN/MANAGER with `avito` section permission: reviews of items in their
 *    assigned modules only (or `moduleSlug=none` returns nothing for them).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();

    const role = session.user.role;
    const isSuper = role === "SUPERADMIN";
    if (!isSuper) {
      const allowed = await hasAdminSectionAccess(session.user.id, "avito");
      if (!allowed) return apiForbidden("Нет доступа к разделу Деловой Авито");
    }

    const parsed = AvitoReviewsQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams.entries())
    );
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0]?.message ?? "invalid query");
    }
    const { moduleSlug, minRating, maxRating, limit } = parsed.data;

    // Resolve set of allowed module slugs for non-super users.
    let allowedModules: Set<string> | null = null;
    if (!isSuper) {
      const myModules = await getUserModules(session.user.id);
      allowedModules = new Set(myModules);
    }

    // Build item filter (no need to fetch all reviews if user has no modules).
    const itemWhere: {
      moduleSlug?: string | null | { in: string[] };
      deletedAt: null;
    } = { deletedAt: null };
    if (moduleSlug === "none") {
      itemWhere.moduleSlug = null;
    } else if (moduleSlug && moduleSlug !== "all") {
      if (!isSuper && allowedModules && !allowedModules.has(moduleSlug)) {
        return apiForbidden("Нет доступа к этому модулю");
      }
      itemWhere.moduleSlug = moduleSlug;
    } else if (!isSuper && allowedModules) {
      if (allowedModules.size === 0) {
        return apiResponse({ reviews: [], avgRating: null, total: 0 });
      }
      itemWhere.moduleSlug = { in: Array.from(allowedModules) };
    }

    const items = await prisma.avitoItem.findMany({
      where: itemWhere,
      select: { id: true, avitoItemId: true, title: true, moduleSlug: true },
    });
    const itemMap = new Map(items.map((it) => [it.id, it]));
    const itemIds = items.map((it) => it.id);
    if (itemIds.length === 0) {
      return apiResponse({ reviews: [], avgRating: null, total: 0 });
    }

    const ratingFilter: { gte?: number; lte?: number } = {};
    if (minRating !== undefined) ratingFilter.gte = minRating;
    if (maxRating !== undefined) ratingFilter.lte = maxRating;
    const ratingWhere = Object.keys(ratingFilter).length > 0 ? ratingFilter : undefined;

    const [reviews, agg, total] = await Promise.all([
      prisma.avitoReview.findMany({
        where: {
          avitoItemId: { in: itemIds },
          ...(ratingWhere ? { rating: ratingWhere } : {}),
        },
        orderBy: { reviewedAt: "desc" },
        take: limit,
      }),
      prisma.avitoReview.aggregate({
        where: {
          avitoItemId: { in: itemIds },
          ...(ratingWhere ? { rating: ratingWhere } : {}),
        },
        _avg: { rating: true },
      }),
      prisma.avitoReview.count({
        where: {
          avitoItemId: { in: itemIds },
          ...(ratingWhere ? { rating: ratingWhere } : {}),
        },
      }),
    ]);

    return apiResponse({
      reviews: reviews.map((r) => ({
        id: r.id,
        avitoReviewId: r.avitoReviewId,
        rating: r.rating,
        authorName: r.authorName,
        body: r.body,
        reviewedAt: r.reviewedAt.toISOString(),
        avitoItem: itemMap.get(r.avitoItemId)
          ? {
              id: r.avitoItemId,
              avitoItemId: itemMap.get(r.avitoItemId)!.avitoItemId,
              title: itemMap.get(r.avitoItemId)!.title,
              moduleSlug: itemMap.get(r.avitoItemId)!.moduleSlug,
            }
          : null,
      })),
      avgRating: agg._avg.rating ?? null,
      total,
    });
  } catch (err) {
    console.error("[GET /api/avito/reviews] error", err);
    return apiServerError();
  }
}
