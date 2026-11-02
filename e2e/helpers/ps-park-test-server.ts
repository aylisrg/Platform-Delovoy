import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";

/** Explicitly refuses production/staging URLs; only the existing local CI services. */
export function paidE2EEnvironment(env: Readonly<Record<string, string | undefined>>) {
  if (env.DEV_OVERLAY !== "1" || env.AUTH_SECRET !== "e2e-ci-secret-not-for-prod-use") {
    throw new Error("Paid E2E requires the explicit synthetic CI environment");
  }
  const database = new URL(env.DATABASE_URL ?? "invalid:");
  const redis = new URL(env.REDIS_URL ?? "invalid:");
  const local = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (!local.has(database.hostname) || !["postgres:", "postgresql:"].includes(database.protocol) ||
      database.pathname !== "/delovoy_park" || database.username !== "delovoy" || database.password !== "delovoy_secret" ||
      database.port !== "5432" || !local.has(redis.hostname) || redis.protocol !== "redis:") {
    throw new Error("Paid E2E requires the existing loopback CI PostgreSQL/Redis services");
  }
  return { databaseURL: database.href, redisURL: redis.href };
}

export async function reservePSParkPort() {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No loopback port allocated");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

export async function startPSParkTestServer(options: {
  port: number; providerOrigin: string; providerToken: string; webhookSecret: string;
}) {
  const connections = paidE2EEnvironment(process.env);
  const directory = resolve(".next/standalone");
  if (!existsSync(resolve(directory, "server.js"))) throw new Error("Run the existing build:e2e before paid E2E");
  // Names only: never read .env contents, and never let Next load inherited secrets.
  if (readdirSync(directory).some(name => /^\.env(?:\.|$)/.test(name))) throw new Error("Paid E2E refuses standalone .env files");
  const origin = `http://127.0.0.1:${options.port}`;
  const child = spawn(process.execPath, ["--require", resolve("e2e/helpers/ps-park-payment-preload.js"), resolve(directory, "server.js")], {
    cwd: directory,
    env: {
      PATH: process.env.PATH, LANG: "C.UTF-8", TZ: "UTC", NODE_ENV: "production",
      HOSTNAME: "127.0.0.1", PORT: String(options.port), NEXT_TELEMETRY_DISABLED: "1",
      DATABASE_URL: connections.databaseURL, REDIS_URL: connections.redisURL,
      AUTH_TRUST_HOST: "true", AUTH_SECRET: "e2e-child-only-synthetic-auth-secret",
      NEXTAUTH_SECRET: "e2e-child-only-synthetic-auth-secret", NEXTAUTH_URL: origin,
      NEXT_PUBLIC_APP_URL: origin, DEV_OVERLAY: "1",
      YOOKASSA_SHOP_ID: "e2e-synthetic-shop", YOOKASSA_SECRET_KEY: "e2e-synthetic-key",
      YOOKASSA_WEBHOOK_SECRET: options.webhookSecret, YOOKASSA_RECEIPTS_ENABLED: "true", YOOKASSA_VAT_CODE: "1",
      PS_PARK_E2E_ONLY: "local-provider-fixture", PS_PARK_E2E_PROVIDER_ORIGIN: options.providerOrigin,
      PS_PARK_E2E_PROVIDER_TOKEN: options.providerToken,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Deliberately do not expose child logs: even failures must not print service URLs/credentials.
  child.stdout.resume(); child.stderr.resume();
  let spawnError: Error | undefined;
  child.once("error", error => { spawnError = error; });
  async function close() {
    if (child.exitCode !== null || child.signalCode !== null || spawnError) return;
    await new Promise<void>(resolve => {
      const timeout = setTimeout(() => child.kill("SIGKILL"), 5_000);
      child.once("exit", () => { clearTimeout(timeout); resolve(); });
      child.kill("SIGTERM");
    });
  }
  try {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (spawnError || child.exitCode !== null) throw new Error("Isolated Next process failed to start");
      try {
        const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(2_000), redirect: "error" });
        if (response.ok) return { origin, close };
      } catch { /* Server is still starting. */ }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error("Isolated Next health check timed out; native Prisma and the seeded local DB are required");
  } catch (error) { await close(); throw error; }
}
