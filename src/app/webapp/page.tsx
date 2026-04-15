"use client";

import { useTelegram } from "@/components/webapp/TelegramProvider";
import Link from "next/link";

const services = [
  {
    href: "/webapp/gazebos",
    icon: "🏕",
    title: "Барбекю Парк",
    subtitle: "Беседки с мангалом, природа, отдых",
    gradient: "from-orange-500 to-amber-400",
  },
  {
    href: "/webapp/ps-park",
    icon: "🎮",
    title: "Плей Парк",
    subtitle: "PlayStation, настолки, кикер",
    gradient: "from-blue-600 to-indigo-500",
  },
];

const quickActions = [
  {
    href: "/webapp/bookings",
    icon: "📋",
    label: "Мои брони",
  },
  {
    href: "/webapp/profile",
    icon: "👤",
    label: "Профиль",
  },
];

export default function WebAppHome() {
  const { ready, user, haptic } = useTelegram();

  if (!ready) {
    return (
      <div className="flex items-center justify-center min-h-[80vh]">
        <div className="tg-skeleton w-8 h-8 rounded-full" />
      </div>
    );
  }

  const greeting = user?.name ? user.name.split(" ")[0] : "друг";

  return (
    <div className="tg-page-enter">
      {/* Header */}
      <div className="px-4 pt-6 pb-2">
        <h1 className="text-[28px] font-bold leading-tight">
          Привет, {greeting}!
        </h1>
        <p className="mt-1 text-[15px]" style={{ color: "var(--tg-hint)" }}>
          Бизнес-парк «Деловой» — Селятино
        </p>
      </div>

      {/* Service cards */}
      <div className="px-4 mt-4 space-y-3">
        {services.map((svc) => (
          <Link
            key={svc.href}
            href={svc.href}
            onClick={() => haptic.impact("light")}
            className="block rounded-2xl overflow-hidden transition-transform active:scale-[0.98]"
          >
            <div className={`relative bg-gradient-to-br ${svc.gradient} p-5 min-h-[120px] flex items-end`}>
              {/* Large background emoji */}
              <span className="absolute top-3 right-4 text-6xl opacity-30 select-none">
                {svc.icon}
              </span>

              <div className="relative z-10">
                <h2 className="text-[22px] font-bold text-white">{svc.title}</h2>
                <p className="text-[14px] text-white/80 mt-0.5">{svc.subtitle}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Quick actions */}
      <div className="px-4 mt-6">
        <p className="tg-section-header">Быстрые действия</p>
        <div className="grid grid-cols-2 gap-3 mt-2">
          {quickActions.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              onClick={() => haptic.selection()}
              className="tg-card flex items-center gap-3 p-4"
            >
              <span className="text-2xl">{action.icon}</span>
              <span className="text-[15px] font-medium">{action.label}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* Info block */}
      <div className="px-4 mt-6 mb-6">
        <div
          className="rounded-2xl p-4"
          style={{ background: "var(--tg-secondary-bg)" }}
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">📍</span>
            <span className="text-[15px] font-semibold">Как добраться</span>
          </div>
          <p className="text-[14px] leading-relaxed" style={{ color: "var(--tg-hint)" }}>
            Московская область, Селятино, ул. Промышленная, д. 25.
            <br />
            5 минут от ж/д станции Селятино.
          </p>
        </div>
      </div>
    </div>
  );
}
