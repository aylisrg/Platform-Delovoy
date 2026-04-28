import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { AvitoAccountDto } from "@/lib/avito";

export function BalanceCard({ account }: { account: AvitoAccountDto }) {
  const balance = account.balanceRub ? Number(account.balanceRub) : null;
  const balanceLabel = balance !== null ? `${balance.toLocaleString("ru-RU")} ₽` : "—";

  return (
    <Card>
      <CardHeader>
        <h2 className="font-semibold text-zinc-900">Аккаунт Avito</h2>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 text-sm">
          <Field label="Баланс" value={balanceLabel} highlight={account.lowBalanceWarning} />
          <Field label="Аккаунт" value={account.accountName ?? "—"} />
          <Field label="Webhook" value={account.webhookEnabled ? "включён" : "выключен"} />
          <Field label="Polling" value={account.pollEnabled ? "включён" : "выключен"} />
        </div>
        {account.lowBalanceWarning && (
          <p className="mt-3 text-xs text-amber-700 bg-amber-50 rounded px-3 py-2 border border-amber-200">
            Низкий баланс. Объявления могут быть сняты с публикации, если списания не пройдут.
          </p>
        )}
        {!account.avitoUserId && (
          <p className="mt-3 text-xs text-zinc-500">
            avitoUserId ещё не получен — запустите{" "}
            <code className="bg-zinc-100 px-1 rounded">/api/cron/avito-account-sync</code>.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-xs text-zinc-500 mb-0.5">{label}</p>
      <p className={`font-semibold ${highlight ? "text-amber-700" : "text-zinc-900"}`}>{value}</p>
    </div>
  );
}
