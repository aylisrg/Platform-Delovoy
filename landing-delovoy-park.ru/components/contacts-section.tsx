import React from "react";
import { YandexMap } from "@/components/ui/yandex-map";

const PHONE = "+74996774888";
const PHONE_DISPLAY = "+7 (499) 677-48-88";
const WHATSAPP_NUMBER = "74996774888";

// Бизнес-парк "Деловой" — Промышленная ул., 1, пгт Селятино, 143345
// Используем organization ID, не shortlink (последний экспирится).
// Источник: https://yandex.ru/maps/org/delovoy/165904522406/
const PARK_OID = "165904522406";
const PARK_LAT = 55.516945;
const PARK_LON = 36.978520;

const contacts = [
  {
    type: "Телефон",
    value: PHONE_DISPLAY,
    href: `tel:${PHONE}`,
    icon: "phone",
    color: "#0071e3",
    bg: "#0071e3",
  },
  {
    type: "Telegram",
    value: "@DelovoyPark_bot",
    href: "https://t.me/DelovoyPark_bot",
    icon: "telegram",
    color: "#229ED9",
    bg: "#229ED9",
  },
  {
    type: "WhatsApp",
    value: PHONE_DISPLAY,
    href: `https://wa.me/${WHATSAPP_NUMBER}`,
    icon: "whatsapp",
    color: "#25D366",
    bg: "#25D366",
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

function WhatsAppIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  );
}

const icons: Record<string, () => React.ReactElement> = {
  phone: PhoneIcon,
  telegram: TelegramIcon,
  whatsapp: WhatsAppIcon,
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
