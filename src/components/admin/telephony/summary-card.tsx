import Link from "next/link";
import { auth } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { getTelephonyDashboard } from "@/modules/telephony/dashboard-service";

/** The global provider journal must never be read for a module-scoped employee. */
export async function TelephonySummaryCard() {
  const session = await auth();
  if (session?.user?.role !== "SUPERADMIN") return null;

  let dashboard;
  try {
    dashboard = await getTelephonyDashboard({ period: "today", filter: "all", page: 1 });
  } catch {
    return (
      <section aria-label="Звонки сегодня" className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5">
        <h2 className="font-semibold text-zinc-900">Звонки сегодня</h2>
        <p className="mt-1 text-sm text-amber-700">Не удалось загрузить статистику звонков.</p>
        <Link href="/admin/telephony" className="mt-3 inline-block text-sm font-medium text-blue-600 hover:underline">
          Открыть раздел звонков →
        </Link>
      </section>
    );
  }

  const { summary, source } = dashboard;
  const configured = source.dataApiConfigured || source.webhookConfigured;

  return (
    <section aria-label="Звонки сегодня" className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-zinc-900">Звонки сегодня <span className="ml-2 text-xs font-normal text-zinc-500">Novofon · МСК</span></h2>
          <p className="mt-1 text-sm text-zinc-500">Входящие обращения и исходящие звонки парка</p>
        </div>
        <Link href="/admin/telephony" className="rounded-lg px-2 py-1 text-sm font-medium text-blue-600 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-600">
          Вся статистика →
        </Link>
      </div>
      <dl className="mt-5 grid grid-cols-3 gap-3">
        <div><dt className="text-xs text-zinc-500">Всего звонков</dt><dd className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900">{summary.total}</dd></div>
        <div><dt className="text-xs text-zinc-500">Принято входящих</dt><dd className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900">{summary.answered}</dd></div>
        <div>
          <dt className="text-xs text-zinc-500">Пропущено входящих</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums">
            <Link href="/admin/telephony?filter=missed" aria-label={`Пропущено входящих: ${summary.missed}. Открыть журнал`} className={summary.missed > 0 ? "text-red-600 hover:underline" : "text-zinc-900 hover:underline"}>{summary.missed}</Link>
          </dd>
        </div>
      </dl>
      {!configured && <p className="mt-4 text-sm text-amber-700">Источники Novofon не настроены. Показаны только сохранённые звонки.</p>}
      {configured && !source.lastCallAt && <p className="mt-4 text-sm text-zinc-500">В журнале пока нет данных. Ожидаем звонки от Novofon.</p>}
      {source.lastJournalUpdate && <p className="mt-4 text-xs text-zinc-500">Последнее изменение журнала: {formatDateTime(source.lastJournalUpdate)} МСК</p>}
    </section>
  );
}
