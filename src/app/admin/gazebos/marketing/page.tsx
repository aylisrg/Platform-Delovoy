import Link from "next/link";
import { AdminHeader } from "@/components/admin/header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { StatusWidget } from "@/components/admin/status-widget";
import { getGazebosMarketingStats } from "@/modules/gazebos/marketing-service";

export const dynamic = "force-dynamic";

function NotConfiguredCard({ title, docsHref }: { title: string; docsHref?: string }) {
  return (
    <Card>
      <CardHeader>
        <h2 className="font-semibold text-zinc-900">{title}</h2>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-zinc-500 mb-3">
          Интеграция не настроена. Добавьте переменные окружения в&nbsp;<code className="bg-zinc-100 px-1 rounded text-xs">.env</code>.
        </p>
        {docsHref && (
          <a
            href={docsHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-600 hover:underline"
          >
            Документация →
          </a>
        )}
      </CardContent>
    </Card>
  );
}

export default async function GazebosMarketingPage() {
  const stats = await getGazebosMarketingStats();
  const { avito, yandex } = stats;

  const cachedAt = stats.cachedAt
    ? new Date(stats.cachedAt).toLocaleString("ru-RU")
    : null;

  return (
    <>
      <AdminHeader title="Реклама и аналитика — Беседки" />
      <div className="p-8">
        {/* Back link */}
        <Link
          href="/admin/gazebos"
          className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 mb-8"
        >
          ← Беседки
        </Link>

        {/* Date range info */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">Последние 30 дней</h2>
            <p className="text-sm text-zinc-500">
              {avito.dateFrom} — {avito.dateTo}
            </p>
          </div>
          {cachedAt && (
            <p className="text-xs text-zinc-400">Обновлено: {cachedAt}</p>
          )}
        </div>

        {/* Avito Block */}
        <section className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-base font-semibold text-zinc-900">Авито</h2>
            {avito.configured ? (
              <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5">Подключено</span>
            ) : (
              <span className="text-xs bg-zinc-100 text-zinc-500 rounded-full px-2 py-0.5">Не настроено</span>
            )}
          </div>

          {!avito.configured ? (
            <NotConfiguredCard
              title="Авито — статистика объявлений"
              docsHref="https://developers.avito.ru/api-catalog"
            />
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <StatusWidget
                title="Просмотры"
                value={avito.views.toLocaleString("ru-RU")}
                status="info"
              />
              <StatusWidget
                title="Уникальные просмотры"
                value={avito.uniqViews.toLocaleString("ru-RU")}
                status="info"
              />
              <StatusWidget
                title="Клики «Позвонить»"
                value={avito.contacts.toLocaleString("ru-RU")}
                status={avito.contacts > 0 ? "success" : "info"}
              />
              <StatusWidget
                title="В избранном"
                value={avito.favorites.toLocaleString("ru-RU")}
                status="info"
              />
              <StatusWidget
                title="Звонки"
                value={avito.calls.toLocaleString("ru-RU")}
                status={avito.calls > 0 ? "success" : "info"}
              />
              <StatusWidget
                title="Пропущенные"
                value={avito.missedCalls.toLocaleString("ru-RU")}
                status={avito.missedCalls > 0 ? "warning" : "success"}
              />
            </div>
          )}
        </section>

        {/* Yandex Direct Block */}
        <section className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-base font-semibold text-zinc-900">Яндекс Директ</h2>
            {yandex.direct.configured ? (
              <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5">Подключено</span>
            ) : (
              <span className="text-xs bg-zinc-100 text-zinc-500 rounded-full px-2 py-0.5">Не настроено</span>
            )}
          </div>

          {!yandex.direct.configured ? (
            <NotConfiguredCard
              title="Яндекс Директ — рекламные кампании"
              docsHref="https://yandex.ru/dev/direct/doc/reports/reports.html"
            />
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatusWidget
                title="Показы"
                value={yandex.direct.impressions.toLocaleString("ru-RU")}
                status="info"
              />
              <StatusWidget
                title="Клики"
                value={yandex.direct.clicks.toLocaleString("ru-RU")}
                status={yandex.direct.clicks > 0 ? "success" : "info"}
              />
              <StatusWidget
                title="Расход"
                value={`${yandex.direct.cost.toLocaleString("ru-RU")} ₽`}
                status="info"
              />
              <StatusWidget
                title="CTR"
                value={`${yandex.direct.ctr.toFixed(2)}%`}
                status={yandex.direct.ctr > 1 ? "success" : "info"}
              />
            </div>
          )}
        </section>

        {/* Yandex Business / Metrika Block */}
        <section className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-base font-semibold text-zinc-900">Яндекс Бизнес / Метрика</h2>
            {yandex.metrika.configured ? (
              <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5">Подключено</span>
            ) : (
              <span className="text-xs bg-zinc-100 text-zinc-500 rounded-full px-2 py-0.5">Не настроено</span>
            )}
          </div>

          {!yandex.metrika.configured ? (
            <NotConfiguredCard
              title="Яндекс Метрика — трафик и события"
              docsHref="https://yandex.ru/dev/metrika/doc/api2/api_v1/data.html"
            />
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <StatusWidget
                title="Визиты на сайт"
                value={yandex.metrika.visits.toLocaleString("ru-RU")}
                status="info"
              />
              <StatusWidget
                title="Звонки с карточки"
                value={yandex.metrika.callsFromBusiness.toLocaleString("ru-RU")}
                status={yandex.metrika.callsFromBusiness > 0 ? "success" : "info"}
              />
              <StatusWidget
                title="Маршруты"
                value={yandex.metrika.routesFromBusiness.toLocaleString("ru-RU")}
                status={yandex.metrika.routesFromBusiness > 0 ? "success" : "info"}
              />
            </div>
          )}
        </section>

        {/* Setup instructions card */}
        {(!avito.configured || !yandex.direct.configured || !yandex.metrika.configured) && (
          <Card>
            <CardHeader>
              <h2 className="font-semibold text-zinc-900">Как подключить</h2>
            </CardHeader>
            <CardContent className="text-sm text-zinc-600 space-y-3">
              {!avito.configured && (
                <div>
                  <p className="font-medium text-zinc-900 mb-1">Авито</p>
                  <p>Добавьте в <code className="bg-zinc-100 px-1 rounded text-xs">.env</code>:</p>
                  <pre className="bg-zinc-50 rounded p-3 mt-1 text-xs overflow-x-auto">
{`AVITO_CLIENT_ID="ваш_client_id"
AVITO_CLIENT_SECRET="ваш_client_secret"
AVITO_ITEM_ID="id_объявления_беседок"`}
                  </pre>
                  <p className="text-xs text-zinc-400 mt-1">
                    Получить client_id и secret: <a href="https://developers.avito.ru" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">developers.avito.ru</a>
                  </p>
                </div>
              )}
              {(!yandex.direct.configured || !yandex.metrika.configured) && (
                <div>
                  <p className="font-medium text-zinc-900 mb-1">Яндекс</p>
                  <p>Добавьте в <code className="bg-zinc-100 px-1 rounded text-xs">.env</code>:</p>
                  <pre className="bg-zinc-50 rounded p-3 mt-1 text-xs overflow-x-auto">
{`YANDEX_OAUTH_TOKEN="OAuth_токен_из_Яндекс_ID"
YANDEX_DIRECT_CLIENT_LOGIN="логин_аккаунта_директ"
YANDEX_METRIKA_COUNTER_ID="id_счётчика"`}
                  </pre>
                  <p className="text-xs text-zinc-400 mt-1">
                    Получить токен: <a href="https://oauth.yandex.ru" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">oauth.yandex.ru</a>
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
