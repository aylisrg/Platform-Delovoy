/**
 * Юнит-тесты логики Service Worker (public/sw.js).
 *
 * SW — классический скрипт без модулей, поэтому исполняем его в vm-контексте
 * с заглушками SW-окружения и тестируем чистые функции через self.__testables.
 * Инвариант инцидента 2026-07-20: никакая ошибка Cache API не должна ронять
 * ответ на запрос (quota-смерть страницы).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";

type Testables = {
  SW_VERSION: string;
  WEBAPP_SHELL_CACHE: string;
  MAX_CACHE_ENTRIES: number;
  deleteStaleCaches: (caches: FakeCacheStorage) => Promise<void>;
  trimCache: (cache: FakeCache, maxEntries: number) => Promise<void>;
  staticAssetResponse: (
    caches: FakeCacheStorage | FailingCacheStorage,
    request: string,
    fetchFn: (req: string) => Promise<Response>,
  ) => Promise<Response>;
  webappNavigationResponse: (
    caches: FakeCacheStorage | FailingCacheStorage,
    request: string,
    fetchFn: (req: string) => Promise<Response>,
  ) => Promise<Response>;
};

class FakeCache {
  store = new Map<string, Response>();
  putShouldThrow = false;

  async match(request: string): Promise<Response | undefined> {
    return this.store.get(request);
  }
  async put(request: string, response: Response): Promise<void> {
    if (this.putShouldThrow) throw new Error("QuotaExceededError");
    this.store.set(request, response);
  }
  async delete(request: string): Promise<boolean> {
    return this.store.delete(request);
  }
  async keys(): Promise<string[]> {
    return [...this.store.keys()];
  }
}

class FakeCacheStorage {
  caches = new Map<string, FakeCache>();

  async open(name: string): Promise<FakeCache> {
    if (!this.caches.has(name)) this.caches.set(name, new FakeCache());
    const cache = this.caches.get(name);
    if (!cache) throw new Error("unreachable");
    return cache;
  }
  async keys(): Promise<string[]> {
    return [...this.caches.keys()];
  }
  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name);
  }
}

class FailingCacheStorage {
  async open(): Promise<never> {
    throw new Error("QuotaExceededError");
  }
  async keys(): Promise<string[]> {
    return [];
  }
  async delete(): Promise<boolean> {
    return false;
  }
}

let t: Testables;

beforeAll(() => {
  const source = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
  const self = {
    addEventListener: () => undefined,
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
    registration: {},
    location: { origin: "https://delovoy-park.ru" },
  } as Record<string, unknown>;
  const context = createContext({
    self,
    caches: new FakeCacheStorage(),
    fetch: () => Promise.reject(new Error("network disabled in tests")),
    Response,
    URL,
    atob,
    btoa,
    console,
  });
  runInContext(source, context);
  t = (self as { __testables?: Testables }).__testables as Testables;
  expect(t).toBeDefined();
});

const ok = (body = "js") => new Response(body, { status: 200 });

describe("staticAssetResponse", () => {
  it("returns cached response on hit without touching network", async () => {
    const storage = new FakeCacheStorage();
    const cache = await storage.open(t.WEBAPP_SHELL_CACHE);
    const cached = ok("cached");
    cache.store.set("/_next/static/a.js", cached);
    let fetched = 0;
    const res = await t.staticAssetResponse(storage, "/_next/static/a.js", () => {
      fetched++;
      return Promise.resolve(ok());
    });
    expect(res).toBe(cached);
    expect(fetched).toBe(0);
  });

  it("fetches and caches on miss", async () => {
    const storage = new FakeCacheStorage();
    const res = await t.staticAssetResponse(storage, "/_next/static/b.js", () =>
      Promise.resolve(ok("fresh")),
    );
    expect(res.status).toBe(200);
    const cache = await storage.open(t.WEBAPP_SHELL_CACHE);
    expect(cache.store.has("/_next/static/b.js")).toBe(true);
  });

  it("falls back to plain fetch when the cache backend is broken (quota)", async () => {
    const res = await t.staticAssetResponse(
      new FailingCacheStorage(),
      "/_next/static/c.js",
      () => Promise.resolve(ok("net")),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("net");
  });

  it("still returns the network response when cache.put throws", async () => {
    const storage = new FakeCacheStorage();
    const cache = await storage.open(t.WEBAPP_SHELL_CACHE);
    cache.putShouldThrow = true;
    const res = await t.staticAssetResponse(storage, "/_next/static/d.js", () =>
      Promise.resolve(ok("survived")),
    );
    expect(await res.text()).toBe("survived");
  });

  it("does not cache non-ok responses", async () => {
    const storage = new FakeCacheStorage();
    await t.staticAssetResponse(storage, "/_next/static/e.js", () =>
      Promise.resolve(new Response("gone", { status: 404 })),
    );
    const cache = await storage.open(t.WEBAPP_SHELL_CACHE);
    expect(cache.store.size).toBe(0);
  });
});

describe("trimCache", () => {
  it("evicts oldest entries beyond the limit", async () => {
    const cache = new FakeCache();
    for (let i = 0; i < 5; i++) cache.store.set(`/chunk-${i}.js`, ok());
    await t.trimCache(cache, 3);
    expect([...cache.store.keys()]).toEqual([
      "/chunk-2.js",
      "/chunk-3.js",
      "/chunk-4.js",
    ]);
  });

  it("keeps everything when under the limit", async () => {
    const cache = new FakeCache();
    cache.store.set("/a.js", ok());
    await t.trimCache(cache, 3);
    expect(cache.store.size).toBe(1);
  });

  it("static handler applies MAX_CACHE_ENTRIES cap", async () => {
    const storage = new FakeCacheStorage();
    for (let i = 0; i < t.MAX_CACHE_ENTRIES + 5; i++) {
      await t.staticAssetResponse(storage, `/_next/static/n${i}.js`, () =>
        Promise.resolve(ok()),
      );
    }
    const cache = await storage.open(t.WEBAPP_SHELL_CACHE);
    expect(cache.store.size).toBe(t.MAX_CACHE_ENTRIES);
  });
});

describe("deleteStaleCaches", () => {
  it("removes every cache except the current version", async () => {
    const storage = new FakeCacheStorage();
    await storage.open("webapp-shell-v1");
    await storage.open(t.WEBAPP_SHELL_CACHE);
    await storage.open("some-other-cache");
    await t.deleteStaleCaches(storage);
    expect(await storage.keys()).toEqual([t.WEBAPP_SHELL_CACHE]);
  });
});

describe("webappNavigationResponse", () => {
  it("prefers the network when it works", async () => {
    const res = await t.webappNavigationResponse(
      new FakeCacheStorage(),
      "/webapp",
      () => Promise.resolve(ok("live")),
    );
    expect(await res.text()).toBe("live");
  });

  it("serves cached offline shell when network fails", async () => {
    const storage = new FakeCacheStorage();
    const cache = await storage.open(t.WEBAPP_SHELL_CACHE);
    cache.store.set("/webapp/offline", ok("offline-shell"));
    const res = await t.webappNavigationResponse(storage, "/webapp", () =>
      Promise.reject(new Error("offline")),
    );
    expect(await res.text()).toBe("offline-shell");
  });

  it("returns 503 when both network and cache are unavailable", async () => {
    const res = await t.webappNavigationResponse(
      new FailingCacheStorage(),
      "/webapp",
      () => Promise.reject(new Error("offline")),
    );
    expect(res.status).toBe(503);
  });
});

describe("cache versioning", () => {
  it("cache name is derived from SW_VERSION (deploy bumps invalidate old caches)", () => {
    expect(t.WEBAPP_SHELL_CACHE).toBe(`webapp-shell-${t.SW_VERSION}`);
  });
});
