import type { NextRequest } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import {
  getAppOrigin,
  isAutomatedRequest,
  recordLinkClick,
  resolveLinkForRedirect,
} from "@/modules/notifications/tracking/link-service";

/**
 * GET|HEAD /r/{code} — tracking redirect for notification buttons
 * (ADR 2026-10-25-team-access-notifications §Q4, US-D3).
 *
 * Public (outside the proxy matcher): it authorizes nobody — the target page
 * checks access as usual (AC-D3.9). Always 302, never 4xx/5xx: an unknown,
 * broken or expired code goes to the home page without revealing whether it
 * existed (AC-D3.4); query parameters are never read (AC-D3.3).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, private",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { ...NO_STORE_HEADERS, Location: location } });
}

function homeUrl(): string {
  return `${new URL(getAppOrigin()).origin}/`;
}

async function handle(request: NextRequest, code: string, method: "GET" | "HEAD"): Promise<Response> {
  try {
    // Over the limit → lose the click record, not the navigation (CGNAT, AC-D3.11).
    if (await rateLimit(request, "public")) return redirect(homeUrl());
  } catch {
    // limiter failure must not block the redirect
  }

  let resolved: Awaited<ReturnType<typeof resolveLinkForRedirect>> = null;
  try {
    resolved = await resolveLinkForRedirect(code);
  } catch (err) {
    console.error("[r] link lookup failed:", err instanceof Error ? err.message : err);
  }
  if (!resolved) return redirect(homeUrl());

  if (!isAutomatedRequest(request.headers, method)) {
    try {
      await recordLinkClick(resolved.linkId, resolved.rootId);
    } catch (err) {
      // A failed write never blocks the click-through (AC-D3.2).
      console.error("[r] click record failed:", err instanceof Error ? err.message : err);
    }
  }
  return redirect(resolved.target);
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(request, code, "GET");
}

export async function HEAD(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(request, code, "HEAD");
}
