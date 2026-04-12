/**
 * Avito API client
 * Docs: https://developers.avito.ru/api-catalog
 *
 * Auth: OAuth2 client_credentials flow
 * Token valid for 24 hours — cached in Redis
 */

import { redis, redisAvailable } from "@/lib/redis";

const AVITO_AUTH_URL = "https://api.avito.ru/token";
const AVITO_API_URL = "https://api.avito.ru";
const TOKEN_CACHE_KEY = "avito:access_token";

export type AvitoItemStats = {
  itemId: number;
  views: number;
  contacts: number; // clicks on "show phone"
  favorites: number;
  uniqViews: number;
};

export type AvitoCallStats = {
  itemId: number;
  calls: number;
  missedCalls: number;
  avgCallDuration: number; // seconds
};

export type AvitoMarketingStats = {
  itemId: string;
  views: number;
  uniqViews: number;
  contacts: number;
  favorites: number;
  calls: number;
  missedCalls: number;
  dateFrom: string;
  dateTo: string;
  configured: boolean;
};

function isConfigured(): boolean {
  return !!(
    process.env.AVITO_CLIENT_ID &&
    process.env.AVITO_CLIENT_SECRET &&
    process.env.AVITO_ITEM_ID
  );
}

async function getAccessToken(): Promise<string | null> {
  if (!isConfigured()) return null;

  // Try cache first
  if (redisAvailable) {
    try {
      const cached = await redis.get(TOKEN_CACHE_KEY);
      if (cached) return cached;
    } catch {
      // Redis unavailable — proceed without cache
    }
  }

  const res = await fetch(AVITO_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.AVITO_CLIENT_ID!,
      client_secret: process.env.AVITO_CLIENT_SECRET!,
    }),
    next: { revalidate: 0 },
  });

  if (!res.ok) return null;

  const data = (await res.json()) as { access_token: string; expires_in: number };

  if (redisAvailable) {
    try {
      // Cache slightly less than actual expiry (23.5h)
      await redis.setex(TOKEN_CACHE_KEY, data.expires_in - 1800, data.access_token);
    } catch {
      // Ignore cache errors
    }
  }

  return data.access_token;
}

export async function getAvitoItemStats(
  dateFrom: string,
  dateTo: string
): Promise<AvitoMarketingStats> {
  const empty: AvitoMarketingStats = {
    itemId: process.env.AVITO_ITEM_ID ?? "",
    views: 0,
    uniqViews: 0,
    contacts: 0,
    favorites: 0,
    calls: 0,
    missedCalls: 0,
    dateFrom,
    dateTo,
    configured: false,
  };

  if (!isConfigured()) return empty;

  const token = await getAccessToken();
  if (!token) return empty;

  const itemId = process.env.AVITO_ITEM_ID!;

  try {
    // Fetch item stats and call stats in parallel
    const [itemRes, callRes] = await Promise.allSettled([
      fetch(`${AVITO_API_URL}/stats/v1/accounts/self/items`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dateFrom,
          dateTo,
          fields: ["uniqViews", "views", "contacts", "favorites"],
          itemIds: [parseInt(itemId, 10)],
          periodGrouping: "total",
        }),
        next: { revalidate: 0 },
      }),
      fetch(
        `${AVITO_API_URL}/call-tracking/v1/accounts/self/calls/stats?itemId=${itemId}&dateFrom=${dateFrom}&dateTo=${dateTo}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          next: { revalidate: 0 },
        }
      ),
    ]);

    let views = 0;
    let uniqViews = 0;
    let contacts = 0;
    let favorites = 0;

    if (itemRes.status === "fulfilled" && itemRes.value.ok) {
      const data = (await itemRes.value.json()) as {
        result?: { items?: Array<{ stats?: Array<{ uniqViews?: number; views?: number; contacts?: number; favorites?: number }> }> };
      };
      const stats = data?.result?.items?.[0]?.stats?.[0];
      views = stats?.views ?? 0;
      uniqViews = stats?.uniqViews ?? 0;
      contacts = stats?.contacts ?? 0;
      favorites = stats?.favorites ?? 0;
    }

    let calls = 0;
    let missedCalls = 0;

    if (callRes.status === "fulfilled" && callRes.value.ok) {
      const data = (await callRes.value.json()) as {
        result?: { totalCalls?: number; missedCalls?: number };
      };
      calls = data?.result?.totalCalls ?? 0;
      missedCalls = data?.result?.missedCalls ?? 0;
    }

    return {
      itemId,
      views,
      uniqViews,
      contacts,
      favorites,
      calls,
      missedCalls,
      dateFrom,
      dateTo,
      configured: true,
    };
  } catch {
    return { ...empty, configured: true };
  }
}
