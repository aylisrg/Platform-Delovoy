import { apiResponse } from "@/lib/api-response";
import { redisAvailable } from "@/lib/redis";

export async function GET() {
  const hasToken = !!process.env.YANDEX_OAUTH_TOKEN;
  const hasLogin = !!process.env.YANDEX_DIRECT_CLIENT_LOGIN;

  const status = hasToken && hasLogin && redisAvailable ? "healthy" : "degraded";

  return apiResponse({
    status,
    module: "analytics",
    timestamp: new Date().toISOString(),
    checks: {
      yandexToken: { status: hasToken ? "healthy" : "unhealthy" },
      directLogin: { status: hasLogin ? "healthy" : "unhealthy" },
      redis: { status: redisAvailable ? "healthy" : "unhealthy" },
    },
  });
}
