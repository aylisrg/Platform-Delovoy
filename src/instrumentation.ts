/**
 * Next.js instrumentation hook — выполняется один раз при старте сервера.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *
 * Ставит process-level гарды: без обработчика unhandledRejection Node
 * (>=15) РОНЯЕТ процесс на любом необработанном reject'е фоновой задачи —
 * весь сайт падает из-за одного fire-and-forget промиса. Для
 * uncaughtException используем uncaughtExceptionMonitor: логируем со своим
 * форматом, но не меняем семантику краша (процесс завершится, Docker с
 * restart: unless-stopped поднимет контейнер заново).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Dev hot-reload и повторные вызовы register не должны плодить хендлеры.
  const g = globalThis as unknown as { __delovoyProcessGuards?: boolean };
  if (g.__delovoyProcessGuards) return;
  g.__delovoyProcessGuards = true;

  process.on("unhandledRejection", (reason) => {
    console.error("[process] Unhandled promise rejection:", reason);
    // Best-effort запись в SystemEvent — процесс жив, это не краш-путь.
    void import("@/lib/logger")
      .then(({ log }) =>
        log.error("process", "Unhandled promise rejection", {
          reason: reason instanceof Error ? `${reason.message}\n${reason.stack}` : String(reason),
        })
      )
      .catch(() => {});
  });

  process.on("uncaughtExceptionMonitor", (err, origin) => {
    console.error(`[process] Uncaught exception (${origin}):`, err);
  });
}

/**
 * Next.js хук ошибок render/route/action/proxy — единственное место, где
 * фреймворк сам ловит необработанное исключение и превращает его в 500.
 * https://nextjs.org/docs/app/building-your-application/configuring/instrumentation#onrequesterror-function
 *
 * Записывает SystemEvent с digest/route/стеком (обрезан до 2000 символов) —
 * без этого Error-to-Fix (scripts/analyze-errors.ts) видел только текст
 * сообщения, без возможности воспроизвести баг в тесте (issue #576).
 * Никаких PII: заголовки запроса (могут нести cookie/токены) и тело
 * запроса в metadata не попадают вообще — только path/method из аргументов
 * Next.js, ничего сверх этого не читаем.
 */
export async function onRequestError(
  error: unknown,
  request: Readonly<{ path: string; method: string; headers: Record<string, string | string[] | undefined> }>,
  context: Readonly<{ routerKind: string; routePath: string; routeType: string }>
): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const err = error instanceof Error ? error : new Error(String(error));
    const errDigest = (err as { digest?: unknown }).digest;
    const digest = typeof errDigest === "string" ? errDigest : "no-digest";
    const stack = (err.stack ?? err.message ?? String(error)).slice(0, 2000);

    // Троттлинг по digest — шторм одного и того же исключения не должен
    // плодить тысячи строк SystemEvent (по образцу logCriticalThrottled в
    // src/app/api/health/route.ts). Redis недоступен/упал → пишем как есть,
    // fail-open — не терять инцидент молча важнее случайного дубля.
    let shouldLog = true;
    try {
      const { redis, redisAvailable } = await import("@/lib/redis");
      if (redisAvailable) {
        const acquired = await redis.set(`server-error-throttle:${digest}`, "1", "EX", 60, "NX");
        shouldLog = acquired !== null;
      }
    } catch {
      // Ошибка Redis — троттлинг недоступен, логируем без него.
    }
    if (!shouldLog) return;

    const { log } = await import("@/lib/logger");
    await log.error("server-error", err.message || "Unknown server error", {
      digest,
      route: context.routePath,
      routeType: context.routeType,
      method: request.method,
      // onRequestError фиксирует именно случаи, которые фреймворк сам
      // превращает в 500 (необработанное исключение) — отдельного поля со
      // статусом в аргументах хука нет, но по определению он всегда таков.
      statusCode: 500,
      stack,
    });
  } catch {
    // Логирование ошибки не должно порождать вторую ошибку.
  }
}
