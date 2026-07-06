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
