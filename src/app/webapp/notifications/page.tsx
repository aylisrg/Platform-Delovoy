"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTelegram } from "@/components/webapp/TelegramProvider";
import { Card, EmptyState, Icon, ListItem, Skeleton } from "@/components/webapp/ui";
import { PersonalNotificationSettings } from "@/components/webapp/personal-notification-settings";
import { StaffNotificationPreferences } from "@/components/webapp/staff-notification-preferences";
import { BusinessReportSubscription } from "@/components/webapp/business-report-subscription";
import { canViewBusinessAnalytics } from "@/lib/webapp/types";

/** Public navigation shell; each private preference API retains its own live guard. */
export default function NotificationCenterPage() {
  const { ready, user, capabilities, showBackButton, onBackButtonClick } = useTelegram();
  const router = useRouter();
  useEffect(() => {
    if (!ready) return;
    showBackButton(true);
    onBackButtonClick(() => router.push("/webapp"));
    return () => showBackButton(false);
  }, [ready, router, showBackButton, onBackButtonClick]);

  return (
    <div className="tg-page-enter pb-8">
      <header className="px-4 pt-4">
        <Link href="/webapp" className="inline-flex min-h-11 items-center gap-2 text-[14px] font-medium" style={{ color: "var(--tg-link)" }}><Icon name="home" size={18} />На главную</Link>
        <h1 className="mt-1 text-[24px] font-bold">Центр уведомлений</h1>
        <p className="mt-1 text-[14px]" style={{ color: "var(--tg-hint)" }}>Сообщения, подписки и способы доставки — в одном месте</p>
      </header>
      {!ready ? <div className="px-4 py-5"><Skeleton className="h-36 rounded-2xl" /></div> : !user ? (
        <EmptyState icon="bell" title="Откройте приложение из Telegram" hint="Чтобы настроить личные уведомления, откройте Mini App через бота. Настройки сохраняются в вашем аккаунте." />
      ) : (
        <>
          <div className="px-4 mt-4"><Card><ListItem icon="news" title="Лента сообщений" subtitle="Новые события, статусы и новости парка" href="/webapp#notification-feed" chevron /></Card></div>
          <nav aria-label="Настройки уведомлений" className="flex flex-wrap gap-x-4 gap-y-1 px-4 mt-3 text-[13px] font-medium" style={{ color: "var(--tg-link)" }}>
            {canViewBusinessAnalytics(user, capabilities) && <a href="#business-reports" className="inline-flex min-h-11 items-center">Бизнес-отчёт</a>}
            {capabilities.isStaff && <a href="#platform-updates" className="inline-flex min-h-11 items-center">Обновления платформы</a>}
            <a href="#personal-notifications" className="inline-flex min-h-11 items-center">Личные уведомления</a>
          </nav>
          {canViewBusinessAnalytics(user, capabilities) && <BusinessReportSubscription />}
          <section id="personal-notifications" className="mt-5 scroll-mt-4" aria-label="Личные уведомления"><PersonalNotificationSettings embedded /></section>
          {capabilities.isStaff && <StaffNotificationPreferences />}
        </>
      )}
    </div>
  );
}
