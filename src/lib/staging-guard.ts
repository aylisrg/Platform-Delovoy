/**
 * Staging environment helpers — edge-compatible (no Prisma / no Node built-ins
 * other than global `atob`), safe to import from middleware/proxy.
 *
 * Two responsibilities:
 *   1. `isStaging()` — feature flag for UI components (banner, title tweaks).
 *   2. `checkStagingBasicAuth()` — gate middleware on staging-only Basic Auth.
 *
 * Credentials are read lazily from process.env at call time so that swapping
 * `.env.staging` doesn't require a rebuild.
 */

/** True when the runtime is flagged as staging. */
export function isStaging(): boolean {
  const nodeEnv = process.env.NODE_ENV;
  const publicEnv = process.env.NEXT_PUBLIC_ENV;
  const lockdown = process.env.STAGING_LOCKDOWN;
  return (
    nodeEnv === "staging" ||
    publicEnv === "staging" ||
    lockdown === "true" ||
    lockdown === "1"
  );
}

/** Result of the Basic Auth check. */
export type BasicAuthResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "invalid" };

/**
 * Verify an HTTP Basic Authorization header against the configured
 * STAGING_BASIC_AUTH_USER/PASS env pair. Does nothing (returns ok) if
 * credentials aren't configured — callers must branch on `isStaging()`
 * separately to decide whether to require the header at all.
 */
export function checkStagingBasicAuth(
  header: string | null | undefined
): BasicAuthResult {
  const user = process.env.STAGING_BASIC_AUTH_USER;
  const pass = process.env.STAGING_BASIC_AUTH_PASS;
  // If creds not configured, the guard is a no-op (rely on app-level lockdown only).
  if (!user || !pass) return { ok: true };

  if (!header || !header.toLowerCase().startsWith("basic ")) {
    return { ok: false, reason: "missing" };
  }
  const encoded = header.slice(6).trim();
  let decoded: string;
  try {
    // atob is available in Edge runtime
    decoded = atob(encoded);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  const sep = decoded.indexOf(":");
  if (sep === -1) return { ok: false, reason: "invalid" };
  const gotUser = decoded.slice(0, sep);
  const gotPass = decoded.slice(sep + 1);

  // Constant-ish-time comparison: length first, then each char.
  if (gotUser.length !== user.length || gotPass.length !== pass.length) {
    return { ok: false, reason: "invalid" };
  }
  let diff = 0;
  for (let i = 0; i < user.length; i++) {
    diff |= user.charCodeAt(i) ^ gotUser.charCodeAt(i);
  }
  for (let i = 0; i < pass.length; i++) {
    diff |= pass.charCodeAt(i) ^ gotPass.charCodeAt(i);
  }
  return diff === 0 ? { ok: true } : { ok: false, reason: "invalid" };
}

/**
 * Build a 401 Response asking the browser for credentials.
 */
export function stagingBasicAuthChallenge(): Response {
  return new Response("Staging — требуется авторизация", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Delovoy Staging", charset="UTF-8"',
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

/**
 * Which request paths are always allowed, even on a locked-down staging
 * (used by Timeweb / uptime monitors).
 */
export function isStagingPublicPath(pathname: string): boolean {
  return (
    pathname === "/api/health" ||
    pathname === "/api/health/" ||
    pathname.startsWith("/_next/static/") ||
    pathname.startsWith("/favicon")
  );
}

/**
 * High-level helper used by middleware/proxy: returns null when the request
 * is allowed to proceed, or a 401 Response when Basic Auth is required but
 * missing/invalid. Must be a no-op off-staging so production isn't affected.
 */
export function enforceStagingBasicAuth(
  request: { headers: Headers; nextUrl: { pathname: string } }
): Response | null {
  if (!isStaging()) return null;
  if (isStagingPublicPath(request.nextUrl.pathname)) return null;

  const result = checkStagingBasicAuth(request.headers.get("authorization"));
  if (result.ok) return null;
  return stagingBasicAuthChallenge();
}
