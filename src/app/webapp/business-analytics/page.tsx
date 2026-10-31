"use client";

import { useEffect } from "react";
import { useTelegram } from "@/components/webapp/TelegramProvider";
import { BusinessAnalytics } from "@/components/admin/business-analytics";

export default function WebAppBusinessAnalyticsPage() {
  const { ready, user, capabilities, apiFetch, showBackButton, onBackButtonClick } = useTelegram();
  useEffect(() => {
    showBackButton(true);
    onBackButtonClick(() => window.history.back());
    return () => showBackButton(false);
  }, [showBackButton, onBackButtonClick]);
  if (!ready) return <p role="status" className="p-6 text-sm">Загрузка…</p>;
  const allowed = user?.role === "SUPERADMIN" || (user?.role === "ADMIN" && capabilities.staffSections.includes("analytics"));
  if (!allowed) return <div className="p-6"><h1 className="text-xl font-semibold">Раздел недоступен</h1><p className="mt-2 text-sm" style={{ color: "var(--tg-hint)" }}>Бизнес-аналитика доступна администраторам с разрешением на этот раздел.</p></div>;
  return <BusinessAnalytics miniApp apiFetch={apiFetch} />;
}
