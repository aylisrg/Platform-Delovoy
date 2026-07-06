import { describe, it, expect, vi, afterEach } from "vitest";
import { createSseResponse, sseConnectionCount } from "../sse";

const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  vi.useRealTimers();
});

describe("createSseResponse — cleanup lifecycle", () => {
  it("запускает cleanups и onClose ровно один раз при abort", async () => {
    const ac = new AbortController();
    const cleanup = vi.fn();
    const onClose = vi.fn();

    const res = createSseResponse({
      signal: ac.signal,
      onStart(sse) {
        sse.addCleanup(cleanup);
      },
      onClose,
    });

    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    const reader = res.body!.getReader();
    await reader.read(); // ": connected"

    ac.abort();
    await tick();

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    // Повторное закрытие (cancel после abort) не дублирует cleanup.
    await reader.cancel();
    await tick();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("запускает cleanups при cancel() потока (клиент закрыл соединение)", async () => {
    const ac = new AbortController();
    const cleanup = vi.fn();
    const onClose = vi.fn();

    const res = createSseResponse({
      signal: ac.signal,
      onStart(sse) {
        sse.addCleanup(cleanup);
      },
      onClose,
    });

    await res.body!.cancel();
    await tick();

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("закрывается, если клиент оборвался во время async onStart", async () => {
    const ac = new AbortController();
    const cleanup = vi.fn();

    createSseResponse({
      signal: ac.signal,
      async onStart(sse) {
        sse.addCleanup(cleanup);
        ac.abort(); // обрыв до завершения onStart
      },
    });

    await tick();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("sendEvent сериализует событие в data:", async () => {
    const ac = new AbortController();

    const res = createSseResponse({
      signal: ac.signal,
      onStart(sse) {
        sse.sendEvent({ type: "ping", n: 1 });
      },
    });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    // ": connected", "retry:", затем data-чанк
    for (let i = 0; i < 3; i++) {
      const { value } = await reader.read();
      text += decoder.decode(value);
    }
    expect(text).toContain('data: {"type":"ping","n":1}');
    ac.abort();
  });
});

describe("createSseResponse — keepalive", () => {
  it("тикает по таймеру и останавливается после закрытия", async () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    const onKeepalive = vi.fn();

    createSseResponse({
      signal: ac.signal,
      keepaliveMs: 1_000,
      onStart() {},
      onKeepalive,
    });

    await vi.advanceTimersByTimeAsync(3_000);
    expect(onKeepalive).toHaveBeenCalledTimes(3);

    ac.abort();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(onKeepalive).toHaveBeenCalledTimes(3);
  });
});

describe("createSseResponse — лимит соединений", () => {
  it("отдаёт 429 сверх лимита и освобождает слот после закрытия", async () => {
    const key = `test:${Math.random()}`;
    const controllers = [new AbortController(), new AbortController()];

    const ok1 = createSseResponse({
      signal: controllers[0].signal,
      connectionKey: key,
      maxConnections: 2,
      onStart() {},
    });
    const ok2 = createSseResponse({
      signal: controllers[1].signal,
      connectionKey: key,
      maxConnections: 2,
      onStart() {},
    });
    expect(ok1.status).toBe(200);
    expect(ok2.status).toBe(200);
    expect(sseConnectionCount(key)).toBe(2);

    const rejected = createSseResponse({
      signal: new AbortController().signal,
      connectionKey: key,
      maxConnections: 2,
      onStart() {},
    });
    expect(rejected.status).toBe(429);
    expect(sseConnectionCount(key)).toBe(2);

    controllers[0].abort();
    await tick();
    expect(sseConnectionCount(key)).toBe(1);

    const again = createSseResponse({
      signal: controllers[1].signal,
      connectionKey: key,
      maxConnections: 2,
      onStart() {},
    });
    expect(again.status).toBe(200);

    controllers[1].abort();
    await tick();
  });
});
