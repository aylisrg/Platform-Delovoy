"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTelegram } from "@/components/webapp/TelegramProvider";
import { PersonalNotificationSettings } from "@/components/webapp/personal-notification-settings";

export default function SettingsPage() {
  const { ready, showBackButton, onBackButtonClick } = useTelegram();
  const router = useRouter();
  useEffect(() => {
    if (!ready) return;
    showBackButton(true);
    onBackButtonClick(() => router.push("/webapp/notifications"));
    return () => showBackButton(false);
  }, [ready, router, showBackButton, onBackButtonClick]);
  return <><Link href="/webapp/notifications" className="mx-4 mt-3 inline-flex min-h-11 items-center text-[14px] font-medium" style={{ color: "var(--tg-link)" }}>В центр уведомлений</Link><PersonalNotificationSettings /></>;
}
