import { z } from "zod";

/**
 * Zod schema for validating review data
 */
export const reviewSchema = z.object({
  id: z.string(),
  author: z.string().min(1).max(100),
  rating: z.number().int().min(1).max(5),
  text: z.string().max(1000),
  date: z.string(),
  source: z.literal("yandex"),
});

/**
 * Zod schema for validating reviews cache
 */
export const reviewsCacheSchema = z.object({
  fetchedAt: z.number(),
  reviews: z.array(reviewSchema),
});

/**
 * Zod schema for validating GET /api/reviews query params
 */
export const reviewsQuerySchema = z.object({
  refresh: z.enum(["1"]).optional(),
});
