/**
 * Клиентский хелпер для промежуточных шагов воронки (US-1 эпика #583, ADR
 * 2026-09-16 §5.2). Единственная клиентская часть инструментирования —
 * решающие шаги (view/submitted/paid) пишутся сервером.
 *
 * `sendBeacon` переживает уход со страницы (закрытие вкладки после клика);
 * `fetch(..., { keepalive: true })` — fallback там, где `sendBeacon` нет
 * или он отверг данные (лимит очереди браузера). Ошибки не всплывают —
 * это аналитика, а не бизнес-операция (симметрично AC-1.6 на клиенте).
 */
export function sendFunnelBeacon(funnel: string, step: string): void {
  if (typeof window === "undefined") return;
  const body = JSON.stringify({ funnel, step });

  try {
    if (typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon("/api/analytics/events", blob)) return;
    }
  } catch {
    // Падаем в fetch-фолбэк ниже.
  }

  void fetch("/api/analytics/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
}
