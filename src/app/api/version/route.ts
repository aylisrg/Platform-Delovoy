import { NextResponse } from "next/server";
import { version } from "@/version";

// Public, unauthenticated. Used to verify which build is actually running on
// production — answers "did my fix get deployed?" without SSH or GitHub access.
//
// Build provenance (gitSha, buildTime) is injected via Docker build-args in
// .github/workflows/{ci,deploy}.yml → Dockerfile. When the image is built
// outside CI (local dev, ad-hoc builds), the values fall back to "unknown".

export const dynamic = "force-dynamic";

export async function GET() {
  // Use `||` so an empty-string env var (Docker passes "" when ARG default is
  // empty) falls back to "unknown" instead of leaking a blank value.
  const gitSha = process.env.BUILD_GIT_SHA || "unknown";
  const buildTime = process.env.BUILD_TIME || "unknown";

  return NextResponse.json({
    version,
    gitSha,
    gitShaShort: gitSha.length >= 7 ? gitSha.slice(0, 7) : gitSha,
    buildTime,
    nodeEnv: process.env.NODE_ENV ?? "unknown",
    serverTime: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
  });
}
