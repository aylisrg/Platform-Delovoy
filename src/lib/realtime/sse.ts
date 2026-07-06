/**
 * Общий каркас SSE для route-хендлеров App Router.
 *
 * Гарантирует, что ресурсы соединения (Redis-подписки, keepalive-таймеры,
 * presence-отметки) освобождаются ровно один раз — и при закрытии потока
 * клиентом (ReadableStream.cancel), и при обрыве запроса (request.signal).
 * В standalone-Node за прокси cancel() срабатывает не всегда, поэтому без
 * abort-обработчика утекают setInterval и подписчики realtime-шины —
 * память процесса растёт до OOM.
 *
 * Дополнительно ограничивает число одновременных SSE-соединений на ключ
 * (обычно userId), чтобы вкладки-зомби не исчерпали ресурсы процесса.
 */

export type SseHandle = {
  /** Отправить одно SSE-событие: объект сериализуется в `data: {...}`. */
  sendEvent: (event: unknown) => void;
  /** Зарегистрировать освобождение ресурса; выполнится ровно один раз. */
  addCleanup: (fn: () => void) => void;
};

export const SSE_MAX_CONNECTIONS_PER_KEY = 8;

// Счётчик живых соединений процесса: key → количество.
const connectionCounts = new Map<string, number>();

/** Текущее число живых соединений по ключу (для тестов и диагностики). */
export function sseConnectionCount(key: string): number {
  return connectionCounts.get(key) ?? 0;
}

export function createSseResponse(options: {
  /** request.signal — обрыв клиента, не всегда доходит до cancel(). */
  signal: AbortSignal;
  /** Ключ лимита одновременных соединений (обычно `user:{id}`). */
  connectionKey?: string;
  maxConnections?: number;
  /** Подписки и стартовые действия соединения. */
  onStart: (sse: SseHandle) => void | Promise<void>;
  /** Выполняется ровно один раз при завершении соединения. */
  onClose?: () => void | Promise<void>;
  /** Вызывается после каждого keepalive-тика, пока соединение живо. */
  onKeepalive?: () => void | Promise<void>;
  keepaliveMs?: number;
}): Response {
  const { signal, connectionKey, onStart, onClose, onKeepalive } = options;
  const keepaliveMs = options.keepaliveMs ?? 30_000;
  const maxConnections = options.maxConnections ?? SSE_MAX_CONNECTIONS_PER_KEY;

  if (connectionKey) {
    const current = connectionCounts.get(connectionKey) ?? 0;
    if (current >= maxConnections) {
      return new Response("Too many concurrent event streams", { status: 429 });
    }
    connectionCounts.set(connectionKey, current + 1);
  }

  const encoder = new TextEncoder();
  const cleanups: Array<() => void> = [];
  let closed = false;

  const releaseSlot = () => {
    if (!connectionKey) return;
    const current = connectionCounts.get(connectionKey) ?? 0;
    if (current <= 1) connectionCounts.delete(connectionKey);
    else connectionCounts.set(connectionKey, current - 1);
  };

  // Присваивается синхронно в start() до первого await — cancel() не может
  // выполниться раньше, чем конструктор ReadableStream вернёт управление.
  let runClose: () => void = () => {};

  const stream = new ReadableStream({
    async start(controller) {
      const enqueueRaw = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          runClose();
        }
      };

      runClose = () => {
        if (closed) return;
        closed = true;
        for (const fn of cleanups) {
          try {
            fn();
          } catch {
            /* ошибки одного cleanup не мешают остальным */
          }
        }
        releaseSlot();
        try {
          controller.close();
        } catch {
          /* поток уже закрыт */
        }
        if (onClose) Promise.resolve(onClose()).catch(() => {});
      };

      signal.addEventListener("abort", runClose, { once: true });
      cleanups.push(() => signal.removeEventListener("abort", runClose));

      const keepalive = setInterval(() => {
        enqueueRaw(": keepalive\n\n");
        if (!closed && onKeepalive) Promise.resolve(onKeepalive()).catch(() => {});
      }, keepaliveMs);
      cleanups.push(() => clearInterval(keepalive));

      enqueueRaw(": connected\n\n");
      enqueueRaw("retry: 5000\n\n");

      await onStart({
        sendEvent: (event) => enqueueRaw(`data: ${JSON.stringify(event)}\n\n`),
        addCleanup: (fn) => cleanups.push(fn),
      });

      // Клиент мог оборваться, пока onStart делал async-работу.
      if (signal.aborted) runClose();
    },
    cancel() {
      runClose();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
