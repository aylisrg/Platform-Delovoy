// Test-process-only transport boundary. Production YooKassa client stays unchanged.
// Never inherit this preload into the normal application process.
const nativeFetch = globalThis.fetch;
const fixture = new URL(process.env.PS_PARK_E2E_PROVIDER_ORIGIN || "http://invalid");
const app = new URL(process.env.NEXT_PUBLIC_APP_URL || "http://invalid");
if (process.env.PS_PARK_E2E_ONLY !== "local-provider-fixture" ||
    fixture.hostname !== "127.0.0.1" || fixture.protocol !== "http:" ||
    app.hostname !== "127.0.0.1" || app.protocol !== "http:" ||
    process.env.YOOKASSA_SHOP_ID !== "e2e-synthetic-shop" ||
    process.env.YOOKASSA_SECRET_KEY !== "e2e-synthetic-key" ||
    !process.env.PS_PARK_E2E_PROVIDER_TOKEN) {
  throw new Error("Paid E2E preload requires explicit loopback-only synthetic configuration");
}
globalThis.fetch = async function paidE2EFetch(input, init) {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.origin === "https://api.yookassa.ru" && url.pathname.startsWith("/v3/")) {
    const headers = new Headers(request.headers);
    headers.set("x-e2e-provider-token", process.env.PS_PARK_E2E_PROVIDER_TOKEN);
    return nativeFetch(new URL(url.pathname + url.search, fixture), {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(),
      signal: request.signal,
      redirect: "error",
    });
  }
  if (![fixture.origin, app.origin].includes(url.origin)) {
    throw new Error("Paid E2E blocked external fetch");
  }
  // Redirects cannot escape the loopback allowlist.
  return nativeFetch(request, { redirect: "error" });
};
