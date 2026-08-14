import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-XSS-Protection", value: "1; mode=block" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    // Базовый CSP — разрешает только доверенные источники
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://mc.yandex.ru https://yastatic.net https://telegram.org",
      "style-src 'self' 'unsafe-inline'",
      // #495: шрифты теперь self-hosted (next/font/local) — Google Fonts
      // больше не источник ни на сборке, ни в рантайме.
      "font-src 'self'",
      "img-src 'self' data: blob: https://mc.yandex.ru https://avatars.yandex.net https://lh3.googleusercontent.com https://t.me https://api.telegram.org https://avatars.githubusercontent.com",
      "media-src 'self'",
      "connect-src 'self' https://mc.yandex.ru https://api.telegram.org https://oauth.telegram.org wss://*.delovoy-park.ru",
      "frame-src https://oauth.telegram.org https://yandex.ru https://*.yandex.ru https://*.yandex.net",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {
    root: process.cwd(),
  },
  images: {
    // External avatar/photo sources we render via next/image. Mirrors the
    // img-src directive in CSP above — keep them in sync.
    remotePatterns: [
      { protocol: "https", hostname: "avatars.yandex.net" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "t.me" },
      { protocol: "https", hostname: "api.telegram.org" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
    ],
  },
  async headers() {
    return [
      {
        // Security headers on all routes
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        // Private / always-fresh routes: never cache (auth state, personal
        // data, live booking availability). Public marketing pages are NOT
        // matched here so their ISR cache headers (s-maxage / SWR) survive —
        // a blanket no-store previously defeated all caching and CDN offload.
        source:
          "/((?:admin|dashboard|webapp|api|auth|track|ps-park|gazebos|report).*)",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Pragma",
            value: "no-cache",
          },
        ],
      },
      {
        // Static assets (JS/CSS with hashes): immutable
        source: "/_next/static/(.*)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        // Media files: cache 30 days
        source: "/media/(.*)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=2592000, stale-while-revalidate=86400",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
