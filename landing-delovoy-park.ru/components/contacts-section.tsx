import React from "react";
import { YandexMap } from "@/components/ui/yandex-map";
import { PARK_LOCATION } from "@/lib/park-location";
import { PUBLIC_CONTACTS } from "@/lib/public-contacts";

// Бизнес-парк "Деловой" — Промышленная ул., 1, пгт Селятино, 143345
// Используем organization ID, не shortlink (последний экспирится).
// Источник: https://yandex.ru/maps/org/delovoy/165904522406/
const PARK_OID = PARK_LOCATION.orgId;
const PARK_LAT = PARK_LOCATION.lat;
const PARK_LON = PARK_LOCATION.lon;

const contacts = [
  ...Object.values(PUBLIC_CONTACTS).map((contact) => ({
    type: contact.label,
    value: contact.displayPhone,
    href: `tel:${contact.phone}`,
    icon: "phone",
    color: "#0071e3",
    bg: "#0071e3",
  })),
  {
    type: "Telegram",
    value: "@DelovoyPark_bot",
    href: "https://t.me/DelovoyPark_bot",
    icon: "telegram",
    color: "#229ED9",
    bg: "#229ED9",
  },
];

function PhoneIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 10.8a19.79 19.79 0 01-3.07-8.67A2 2 0 012.18 0h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L6.91 7.09a16 16 0 006 6l.61-.62a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 14.92z" />
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
    </svg>
  );
}

const icons: Record<string, () => React.ReactElement> = {
  phone: PhoneIcon,
  telegram: TelegramIcon,
};

export function ContactsSection() {
  return (
    <section id="contacts" className="bg-white py-24 px-6">
      <div className="max-w-[1200px] mx-auto">
        <div className="mb-14">
          <h2
            className="font-[family-name:var(--font-manrope)] font-[600] text-[#1d1d1f]"
            style={{
              fontSize: "clamp(36px, 5vw, 64px)",
              letterSpacing: "clamp(-1px, -0.03em, -2.5px)",
              lineHeight: 1,
            }}
          >
            Как нас
            <br />
            найти.
          </h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch">
          {/* Yandex Maps — слева, на половину ширины */}
          <YandexMap
            orgId={PARK_OID}
            lat={PARK_LAT}
            lon={PARK_LON}
            zoom={17}
            title="Бизнес-парк «Деловой» — Селятино, Промышленная ул., 1"
            theme="light"
            className="aspect-[4/3] min-h-[460px]"
          />

          {/* Contacts — справа, на половину ширины */}
          <div className="flex flex-col justify-center gap-5">
            <div className="mb-2">
              <p className="text-[#1d1d1f] font-semibold font-[family-name:var(--font-manrope)] text-lg mb-1">
                Бизнес-парк «Деловой»
              </p>
              <p className="text-[#86868b] text-sm font-[family-name:var(--font-inter)] leading-relaxed">
                Московская обл., пгт Селятино, Промышленная ул., 1
                <br />
                <span className="text-[#0071e3] font-medium">30 км от Москвы</span> по Киевскому шоссе · бесплатная парковка
              </p>
            </div>

            <div className="space-y-3">
              {contacts.map((c) => {
                const IconComp = icons[c.icon];
                return (
                  <a
                    key={c.type}
                    href={c.href}
                    target={c.href.startsWith("http") ? "_blank" : undefined}
                    rel={c.href.startsWith("http") ? "noopener noreferrer" : undefined}
                    className="flex items-center gap-4 p-4 rounded-2xl bg-[#f5f5f7] hover:bg-[#ebebed] transition-colors group"
                  >
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-white"
                      style={{ backgroundColor: c.bg }}
                    >
                      <IconComp />
                    </div>
                    <div>
                      <p className="text-[#86868b] text-xs font-[family-name:var(--font-inter)] uppercase tracking-wide">
                        {c.type}
                      </p>
                      <p className="text-[#1d1d1f] font-medium font-[family-name:var(--font-inter)] text-sm group-hover:text-[#0071e3] transition-colors">
                        {c.value}
                      </p>
                    </div>
                    <svg className="w-4 h-4 text-[#86868b] group-hover:text-[#1d1d1f] transition-colors ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </a>
                );
              })}
            </div>

            <a
              href="#offices"
              className="mt-4 inline-flex items-center justify-center bg-[#0071e3] hover:bg-[#0077ED] text-white font-medium text-[15px] px-8 py-4 rounded-full transition-all font-[family-name:var(--font-inter)] self-start"
            >
              Записаться в лист ожидания
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
