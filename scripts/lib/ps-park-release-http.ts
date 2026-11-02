const ORIGIN = "https://delovoy-park.ru";
type ReleaseFetch = typeof fetch;

async function get(path: string, fetcher: ReleaseFetch) {
  const response = await fetcher(`${ORIGIN}${path}`, {
    method: "GET",
    headers: { "User-Agent": "delovoy-release-check-bot", "Cache-Control": "no-cache" },
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("RELEASE_HTTP_CHECK_FAILED");
  return response;
}

/** Read-only checks; no bookings, payment requests or customer notifications. */
export async function verifyPSParkReleaseLive(
  expectedSha: string,
  onlineBookingEnabled?: boolean,
  requireApprovedOffer = false,
  fetcher: ReleaseFetch = fetch,
) {
  const version = await (await get("/api/version", fetcher)).json() as { gitSha?: unknown };
  if (version.gitSha !== expectedSha) throw new Error("LIVE_RELEASE_SHA_MISMATCH");
  const health = await (await get("/api/health", fetcher)).json() as {
    checks?: { database?: { status?: string }; redis?: { status?: string } };
  };
  if (health.checks?.database?.status !== "healthy" || health.checks?.redis?.status !== "healthy") {
    throw new Error("LIVE_DEPENDENCIES_UNHEALTHY");
  }
  if (onlineBookingEnabled === undefined) return;
  const html = await (await get("/ps-park", fetcher)).text();
  const state = onlineBookingEnabled ? "enabled" : "disabled";
  if (!html.includes(`data-online-booking="${state}"`)) throw new Error("LIVE_CHECKOUT_STATE_MISMATCH");
  if (requireApprovedOffer) {
    if (!html.includes('data-online-offer="v2"')) throw new Error("LIVE_OFFER_MISMATCH");
    await get("/ps-park/oferta/v2", fetcher);
  }
}
