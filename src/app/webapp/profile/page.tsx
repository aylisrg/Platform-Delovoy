"use client";

import { useEffect } from "react";
import { useTelegram } from "@/components/webapp/TelegramProvider";

export default function ProfilePage() {
  const { ready, user, showBackButton, onBackButtonClick, close, haptic } =
    useTelegram();

  useEffect(() => {
    showBackButton(true);
    onBackButtonClick(() => window.history.back());
    return () => showBackButton(false);
  }, [showBackButton, onBackButtonClick]);

  if (!ready) {
    return (
      <div className="px-4 pt-4 space-y-4">
        <div className="tg-skeleton h-20 w-20 rounded-full mx-auto" />
        <div className="tg-skeleton h-6 w-32 rounded-lg mx-auto" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <span className="text-5xl">👤</span>
        <p className="mt-4 text-[15px]" style={{ color: "var(--tg-hint)" }}>
          Не удалось загрузить профиль
        </p>
      </div>
    );
  }

  return (
    <div className="tg-page-enter">
      {/* Avatar + Name */}
      <div className="flex flex-col items-center pt-8 pb-4">
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center text-3xl font-bold"
          style={{
            background: "var(--tg-button)",
            color: "var(--tg-button-text)",
          }}
        >
          {user.image ? (
            <img
              src={user.image}
              alt=""
              className="w-full h-full rounded-full object-cover"
            />
          ) : (
            (user.name || "U").charAt(0).toUpperCase()
          )}
        </div>
        <h1 className="mt-3 text-[22px] font-bold">{user.name || "Пользователь"}</h1>
        <p className="text-[14px]" style={{ color: "var(--tg-hint)" }}>
          Бизнес-парк «Деловой»
        </p>
      </div>

      {/* Info section */}
      <div className="px-4 mt-4">
        <p className="tg-section-header">Информация</p>
        <div className="rounded-2xl overflow-hidden mt-2" style={{ background: "var(--tg-secondary-bg)" }}>
          <div className="tg-list-item">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--tg-hint)" strokeWidth="2">
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <div className="flex-1">
              <p className="text-[13px]" style={{ color: "var(--tg-hint)" }}>Имя</p>
              <p className="text-[15px] font-medium">{user.name}</p>
            </div>
          </div>

          <div className="tg-list-item">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--tg-hint)" strokeWidth="2">
              <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
            </svg>
            <div className="flex-1">
              <p className="text-[13px]" style={{ color: "var(--tg-hint)" }}>Telegram ID</p>
              <p className="text-[15px] font-medium">{user.telegramId}</p>
            </div>
          </div>

          <div className="tg-list-item">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--tg-hint)" strokeWidth="2">
              <path d="M12 22s-8-4.5-8-11.8A8 8 0 0112 2a8 8 0 018 8.2c0 7.3-8 11.8-8 11.8z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <div className="flex-1">
              <p className="text-[13px]" style={{ color: "var(--tg-hint)" }}>Роль</p>
              <p className="text-[15px] font-medium">
                {user.role === "SUPERADMIN" ? "Администратор" : user.role === "MANAGER" ? "Менеджер" : "Клиент"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Loyalty placeholder */}
      <div className="px-4 mt-6">
        <p className="tg-section-header">Программа лояльности</p>
        <div
          className="rounded-2xl p-5 mt-2 text-center"
          style={{ background: "var(--tg-secondary-bg)" }}
        >
          <span className="text-4xl">⭐</span>
          <p className="mt-2 text-[15px] font-semibold">Скоро!</p>
          <p className="mt-1 text-[13px]" style={{ color: "var(--tg-hint)" }}>
            Программа лояльности с бонусными баллами и скидками во всех сервисах парка
          </p>
        </div>
      </div>

      {/* Close button */}
      <div className="px-4 mt-8 pb-6">
        <button
          onClick={() => {
            haptic.impact("light");
            close();
          }}
          className="tg-button"
          style={{ background: "var(--tg-secondary-bg)", color: "var(--tg-text)" }}
        >
          Закрыть приложение
        </button>
      </div>
    </div>
  );
}
