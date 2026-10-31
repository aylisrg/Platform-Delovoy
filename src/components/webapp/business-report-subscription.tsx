"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ApiFetchError, useTelegram } from "./TelegramProvider";
import { Badge, Button, Card, Icon, Skeleton, Toggle } from "./ui";
import type { BusinessPreference } from "@/modules/analytics/business-types";

const endpoint = "/api/webapp/business-analytics/subscription";
const deliveryLabels: Record<string, string> = {
  SENT: "Отправлен", DELIVERED: "Доставлен", FAILED: "Не отправлен",
  SKIPPED: "Пропущен", UNKNOWN: "Исход доставки неизвестен", PENDING: "В обработке",
};

/** Preference only: never loads financial reports or enables the subscription on mount. */
export function BusinessReportSubscription() {
  const { apiFetch, haptic } = useTelegram();
  const [preference, setPreference] = useState<BusinessPreference | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [uncertain, setUncertain] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPreference(await apiFetch<BusinessPreference>(endpoint));
      setForbidden(false);
      setUncertain(false);
    } catch (err) {
      setPreference(null);
      if (err instanceof ApiFetchError && (err.status === 401 || err.status === 403)) setForbidden(true);
      else setError("Не удалось загрузить подписку. Попробуйте ещё раз.");
    } finally { setLoading(false); }
  }, [apiFetch]);
  useEffect(() => { void load(); }, [load]);

  async function change(enabled: boolean) {
    if (!preference || saving || uncertain) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    haptic.selection();
    try {
      setPreference(await apiFetch<BusinessPreference>(endpoint, { method: "PUT", body: JSON.stringify({ enabled }) }));
      setSaved(true);
      haptic.notification("success");
    } catch (err) {
      if (err instanceof ApiFetchError && (err.status === 401 || err.status === 403)) {
        setPreference(null);
        setForbidden(true);
      } else {
        // A lost PUT response may follow a committed write. Reconcile before
        // allowing another change; never promise the old value was preserved.
        try {
          setPreference(await apiFetch<BusinessPreference>(endpoint));
          setError("Ответ на сохранение не получен. Текущее состояние подписки обновлено с сервера.");
        } catch (readError) {
          if (readError instanceof ApiFetchError && (readError.status === 401 || readError.status === 403)) {
            setPreference(null);
            setForbidden(true);
          } else {
            setUncertain(true);
            setError("Не удалось подтвердить состояние подписки. Обновите статус перед повторным изменением.");
          }
        }
      }
      haptic.notification("error");
    } finally { setSaving(false); }
  }

  if (forbidden) return null;
  return (
    <section id="business-reports" className="px-4 mt-5 scroll-mt-4" aria-label="Бизнес-аналитика">
      <Card className="overflow-hidden" style={{ border: "1px solid var(--tg-accent)" }}>
        <div className="p-4">
          <div className="flex items-center gap-2" style={{ color: "var(--tg-accent)" }}><Icon name="receipt" size={20} /><span className="text-[13px] font-semibold">Бизнес-аналитика</span></div>
          <h2 className="mt-2 text-[19px] font-bold">Недельный бизнес-отчёт</h2>
          <p className="mt-1 text-[14px] leading-relaxed" style={{ color: "var(--tg-subtitle)" }}>Итоги бизнеса и ссылка на графики в вашем личном Telegram.</p>
          {loading ? <Skeleton className="mt-4 h-20 rounded-xl" /> : preference ? (
            <>
              <div className="mt-4 flex items-center justify-between gap-4">
                <span className="text-[15px] font-medium">{saving ? "Сохраняем…" : uncertain ? "Статус не подтверждён" : preference.enabled ? "Отчёт включён" : "Отчёт выключен"}</span>
                <Toggle label="Недельный бизнес-отчёт" checked={preference.enabled} onChange={change} disabled={saving || uncertain || (!preference.telegramReady && !preference.enabled)} />
              </div>
              <p className="mt-3 text-[13px] leading-relaxed" style={{ color: "var(--tg-subtitle)" }}>{preference.schedule}</p>
              <div className="mt-3"><Badge tone={preference.telegramReady ? "success" : "warning"}>{preference.telegramReady ? "Личный Telegram подключён" : "Нужно подключить Telegram"}</Badge></div>
              {!preference.telegramReady && <p className="mt-2 text-[13px] leading-relaxed" style={{ color: "var(--tg-subtitle)" }}>Привяжите личный Telegram к аккаунту и запустите бота. <Link href="/webapp/profile" className="underline" style={{ color: "var(--tg-link)" }}>Проверить профиль</Link></p>}
              {preference.lastDelivery && <p className="mt-2 text-[12px]" style={{ color: "var(--tg-hint)" }}>Последняя отправка: {deliveryLabels[preference.lastDelivery.status] ?? "Статус уточняется"} · {new Date(preference.lastDelivery.sentAt || preference.lastDelivery.createdAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК</p>}
              {saved && <p role="status" className="mt-2 text-[13px]" style={{ color: "var(--tg-accent)" }}>Настройка сохранена</p>}
            </>
          ) : null}
          {error && <div className="mt-3"><p role="alert" className="text-[13px]" style={{ color: "var(--tg-destructive)" }}>{error}</p>{(!preference || uncertain) && <Button variant="secondary" className="mt-2" onClick={load}>Обновить статус подписки</Button>}</div>}
        </div>
        {preference && <Link href="/webapp/business-analytics" className="flex min-h-12 items-center justify-between gap-3 border-t px-4 py-3 text-[14px] font-semibold" style={{ color: "var(--tg-link)", borderColor: "var(--tg-separator)" }}>Открыть бизнес-аналитику<Icon name="chevron-right" size={18} /></Link>}
      </Card>
    </section>
  );
}
