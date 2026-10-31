"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTelegram } from "@/components/webapp/TelegramProvider";
import { BusinessAnalytics } from "@/components/admin/business-analytics";
import { canViewBusinessAnalytics } from "@/lib/webapp/types";

export default function WebAppBusinessAnalyticsPage() {
  const { ready, user, capabilities, apiFetch, showBackButton, onBackButtonClick } = useTelegram();
  const router = useRouter();
  useEffect(() => {
    if (!ready) return;
    showBackButton(true);
    onBackButtonClick(() => router.push("/webapp/notifications"));
    return () => showBackButton(false);
  }, [ready, router, showBackButton, onBackButtonClick]);
  if (!ready) return <p role="status" className="p-6 text-sm">Загрузка…</p>;
  const allowed = canViewBusinessAnalytics(user, capabilities);
  if (!allowed) return <div className="p-6"><h1 className="text-xl font-semibold">Раздел недоступен</h1><p className="mt-2 text-sm" style={{ color: "var(--tg-hint)" }}>Бизнес-аналитика доступна администраторам с разрешением на этот раздел.</p></div>;
  return <><Link href="/webapp/notifications" className="mx-4 mt-3 inline-flex min-h-11 items-center text-[14px] font-medium" style={{ color: "var(--tg-link)" }}>В центр уведомлений</Link><BusinessAnalytics miniApp apiFetch={apiFetch} /></>;
}
