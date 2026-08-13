"use client";

import { useEffect } from "react";
import Image from "next/image";
import { useTelegram } from "@/components/webapp/TelegramProvider";
import { buildNavigation } from "@/lib/webapp/navigation";
import {
  Badge,
  Card,
  EmptyState,
  ListItem,
  SectionHeader,
  Skeleton,
} from "@/components/webapp/ui";

const ROLE_LABELS: Record<string, string> = {
  SUPERADMIN: "Суперадмин",
  ADMIN: "Администратор",
  MANAGER: "Менеджер",
};

export default function ProfilePage() {
  const {
    ready,
    user,
    capabilities,
    showBackButton,
    onBackButtonClick,
    close,
    haptic,
  } = useTelegram();

  useEffect(() => {
    showBackButton(true);
    onBackButtonClick(() => window.history.back());
    return () => showBackButton(false);
  }, [showBackButton, onBackButtonClick]);

  if (!ready) {
    return (
      <div className="flex flex-col items-center px-4 pt-8 space-y-4">
        <Skeleton className="h-20 w-20 rounded-full" />
        <Skeleton className="h-6 w-32 rounded-lg" />
        <Skeleton className="h-5 w-24 rounded-lg" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <EmptyState
          icon="user"
          title="Профиль недоступен"
          hint="Откройте Mini App через Telegram, чтобы увидеть свои данные"
        />
      </div>
    );
  }

  const roleLabel = ROLE_LABELS[user.role] ?? "Гость";
  const isStaffRole = user.role in ROLE_LABELS;
  // Разделы профиля — единственный источник состава (ADR §1): у сотрудника
  // здесь появляется «Центр уведомлений», у всех — «Уведомления и каналы».
  const { profileEntries } = buildNavigation(capabilities);

  return (
    <div className="tg-page-enter pb-6">
      {/* Avatar + Name + Role */}
      <div className="flex flex-col items-center pt-8 pb-4 px-4">
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center text-3xl font-bold overflow-hidden"
          style={{
            background: "var(--tg-button)",
            color: "var(--tg-button-text)",
          }}
        >
          {user.image ? (
            <Image
              src={user.image}
              alt=""
              width={80}
              height={80}
              className="w-full h-full rounded-full object-cover"
              unoptimized
            />
          ) : (
            (user.name || "U").charAt(0).toUpperCase()
          )}
        </div>
        <h1 className="mt-3 text-[22px] font-bold text-center">
          {user.name || "Пользователь"}
        </h1>
        <div className="mt-2">
          <Badge tone={isStaffRole ? "accent" : "neutral"}>{roleLabel}</Badge>
        </div>
      </div>

      {/* Аккаунт */}
      <div className="px-4 mt-2">
        <SectionHeader>Аккаунт</SectionHeader>
        <Card className="mt-1">
          <ListItem
            icon="user"
            iconTone="hint"
            title="Имя"
            right={
              <span className="text-[15px]" style={{ color: "var(--tg-hint)" }}>
                {user.name || "—"}
              </span>
            }
          />
          <ListItem
            icon="shield"
            iconTone="hint"
            title="Telegram ID"
            right={
              <span className="text-[15px]" style={{ color: "var(--tg-hint)" }}>
                {user.telegramId || "—"}
              </span>
            }
          />
        </Card>
      </div>

      {/* Разделы (в т.ч. Центр уведомлений для сотрудника — AC-4.4) */}
      <div className="px-4 mt-6">
        <SectionHeader>Уведомления</SectionHeader>
        <Card className="mt-1">
          {profileEntries.map((entry) => (
            <ListItem
              key={entry.href}
              icon={entry.icon}
              title={entry.label}
              href={entry.href}
              chevron
              onClick={() => haptic.selection()}
            />
          ))}
        </Card>
      </div>

      {/* Лояльность — заглушка */}
      <div className="px-4 mt-6">
        <SectionHeader>Программа лояльности</SectionHeader>
        <Card className="mt-1">
          <ListItem
            icon="card"
            title="Бонусы и скидки"
            subtitle="Баллы за брони и заказы во всех сервисах парка"
            right={<Badge tone="neutral">Скоро</Badge>}
            disabled
          />
        </Card>
      </div>

      {/* Закрыть приложение */}
      <div className="px-4 mt-6">
        <Card>
          <ListItem
            icon="logout"
            iconTone="destructive"
            title={
              <span style={{ color: "var(--tg-destructive)" }}>
                Закрыть приложение
              </span>
            }
            onClick={() => {
              haptic.impact("light");
              close();
            }}
          />
        </Card>
      </div>
    </div>
  );
}
