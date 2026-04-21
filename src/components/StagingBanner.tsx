import { isStaging } from "@/lib/staging-guard";

/**
 * Жёлтый sticky-баннер "STAGING" поверх всех страниц — защита от путаницы
 * между прод и стейджем. Рендерится только если среда помечена как staging
 * (NODE_ENV=staging, NEXT_PUBLIC_ENV=staging или STAGING_LOCKDOWN=true).
 *
 * Server Component — проверка делается на сервере, баннер просто не попадает
 * в HTML на продакшене.
 */
export function StagingBanner() {
  if (!isStaging()) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className="sticky top-0 z-[9999] w-full bg-yellow-400 text-black text-sm font-semibold px-4 py-2 text-center shadow-md border-b-2 border-yellow-600"
    >
      <span className="mr-2">⚠️</span>
      STAGING — тестовая среда. Данные и заказы ненастоящие, реальных броней не
      создаётся.
    </div>
  );
}
