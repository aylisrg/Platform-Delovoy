import { Card, CardContent, CardHeader } from "@/components/ui/card";

export function NotConfiguredCard() {
  return (
    <Card>
      <CardHeader>
        <h2 className="font-semibold text-zinc-900">Авито API не настроен</h2>
      </CardHeader>
      <CardContent className="text-sm text-zinc-600 space-y-2">
        <p>
          Добавьте в <code className="bg-zinc-100 px-1 rounded text-xs">.env</code>:
        </p>
        <pre className="bg-zinc-50 rounded p-3 mt-1 text-xs overflow-x-auto">
{`AVITO_CLIENT_ID="ваш_client_id"
AVITO_CLIENT_SECRET="ваш_client_secret"
# Опционально (для cron-синхронизации):
AVITO_CRON_ENABLED="true"`}
        </pre>
        <p className="text-xs text-zinc-400">
          Получить client_id и secret:{" "}
          <a href="https://developers.avito.ru" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
            developers.avito.ru
          </a>
        </p>
      </CardContent>
    </Card>
  );
}
