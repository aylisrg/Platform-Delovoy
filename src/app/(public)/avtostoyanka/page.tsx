import type { Metadata } from "next";
import Link from "next/link";
import { getGuardedParkingInfo, getParkingPricing } from "@/modules/parking/service";
import { getPublicPhone } from "@/modules/telephony/service";
import { YandexMap } from "@/components/ui/yandex-map";
import { CallWidget } from "@/components/public/call-widget";
import { Navbar } from "@landing/components/navbar";
import { Footer } from "@landing/components/footer";

// Телефон берётся из конфигурации в БД (getPublicPhone) — рендерим по запросу,
// как на странице /gazebos, чтобы сборка не пыталась пререндерить без БД.
export const dynamic = "force-dynamic";

const APP_URL = "https://delovoy-park.ru";
const ACCENT = "#16A34A";
const PARK_LAT = 55.519479;
const PARK_LON = 36.978566;

const fmt = (n: number) => n.toLocaleString("ru-RU") + " ₽";

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Главная", item: APP_URL },
        { "@type": "ListItem", position: 2, name: "Автостоянка", item: `${APP_URL}/avtostoyanka` },
      ],
    },
    {
      "@type": "ParkingFacility",
      "@id": `${APP_URL}/avtostoyanka`,
      name: "Охраняемая автостоянка — Деловой Парк",
      description:
        "Охраняемая автостоянка в Селятино: круглосуточно, видеонаблюдение, освещение. Ночной и суточный тариф для легкового и грузового транспорта.",
      url: `${APP_URL}/avtostoyanka`,
      address: {
        "@type": "PostalAddress",
        addressLocality: "Селятино",
        addressRegion: "Московская область",
        addressCountry: "RU",
      },
      geo: { "@type": "GeoCoordinates", latitude: PARK_LAT, longitude: PARK_LON },
      openingHoursSpecification: {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
        opens: "00:00",
        closes: "23:59",
      },
    },
  ],
};

export const metadata: Metadata = {
  title: "Автостоянка",
  description:
    "Охраняемая автостоянка в бизнес-парке Деловой, Селятино. Круглосуточно, видеонаблюдение, освещение. Ночной и суточный тариф для легкового и грузового транспорта.",
  alternates: { canonical: "/avtostoyanka" },
  openGraph: {
    title: "Охраняемая автостоянка — Деловой Парк",
    description:
      "Оставьте авто под охраной: круглосуточно, видеонаблюдение, освещение. Селятино, 30 км от Москвы по Киевскому шоссе.",
    url: "/avtostoyanka",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
};

// Иконки по порядку карточек преимуществ.
const FEATURE_ICONS = [
  // Охрана — щит
  "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  // Видеонаблюдение — камера
  "M23 7l-7 5 7 5V7zM1 5h15v14H1z",
  // Любой транспорт — грузовик
  "M1 3h15v13H1zM16 8h4l3 3v5h-7V8zM5.5 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM18.5 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3z",
  // Освещение — лампочка
  "M9 18h6M10 22h4M12 2a7 7 0 00-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0012 2z",
  // Ночь/сутки — часы
  "M12 22a10 10 0 100-20 10 10 0 000 20zM12 6v6l4 2",
  // Удобный въезд — точка на карте
  "M12 22s-8-7.5-8-13a8 8 0 0116 0c0 5.5-8 13-8 13zM12 9a3 3 0 100 6 3 3 0 000-6z",
];

export default async function AvtostoyankaPage() {
  const [info, phoneInfo] = await Promise.all([
    Promise.resolve(getGuardedParkingInfo()),
    getPublicPhone("parking"),
  ]);
  const pricing = getParkingPricing();

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="bg-white min-h-screen">
        <Navbar />

        {/* Hero */}
        <section className="relative overflow-hidden pt-28 pb-16 px-6">
          {/* Мягкий зелёный градиент-фон */}
          <div
            className="absolute inset-0 -z-10"
            style={{
              background:
                "radial-gradient(1200px 500px at 50% -10%, rgba(22,163,74,0.10), transparent 60%)",
            }}
          />
          <div className="max-w-[1200px] mx-auto">
            <Link
              href="/"
              className="text-[#86868b] hover:text-[#1d1d1f] text-sm font-[family-name:var(--font-inter)] transition-colors"
            >
              ← Главная
            </Link>
            <div className="mt-6 max-w-3xl">
              <span
                className="inline-block text-xs font-medium px-3 py-1 rounded-full font-[family-name:var(--font-inter)]"
                style={{ backgroundColor: `${ACCENT}18`, color: ACCENT }}
              >
                Отдельная услуга · для всех
              </span>
              <h1
                className="font-[family-name:var(--font-manrope)] font-[500] text-[#1d1d1f] mt-5"
                style={{ fontSize: "clamp(38px, 6vw, 64px)", letterSpacing: "-2px", lineHeight: 0.98 }}
              >
                Охраняемая автостоянка
              </h1>
              <p className="text-[#4b4b4f] font-[family-name:var(--font-inter)] text-lg mt-5 leading-relaxed">
                {info.tagline}. Круглосуточный доступ, видеонаблюдение и освещение —
                в бизнес-парке «Деловой», Селятино.
              </p>

              <div className="flex flex-wrap items-center gap-3 mt-8">
                {phoneInfo && (
                  <a
                    href={`tel:${phoneInfo.phone}`}
                    className="inline-flex items-center gap-2 bg-[#1d1d1f] text-white font-[family-name:var(--font-manrope)] font-medium text-sm px-5 py-3 rounded-full hover:bg-black transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.5a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2.69h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9.4a16 16 0 0 0 6.29 6.29l.94-.94a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                    </svg>
                    Позвонить {phoneInfo.displayPhone}
                  </a>
                )}
                <a
                  href="#price"
                  className="inline-flex items-center gap-2 font-[family-name:var(--font-inter)] font-medium text-sm px-5 py-3 rounded-full transition-colors"
                  style={{ backgroundColor: `${ACCENT}15`, color: ACCENT }}
                >
                  Смотреть прайс
                </a>
              </div>

              {/* Chips: режим работы + адрес */}
              <div className="flex flex-wrap gap-x-8 gap-y-2 mt-8 text-sm font-[family-name:var(--font-inter)]">
                <span className="text-[#86868b]">
                  <span className="text-[#1d1d1f] font-medium">Режим работы:</span> {info.hours}
                </span>
                <span className="text-[#86868b]">
                  <span className="text-[#1d1d1f] font-medium">Адрес:</span> {info.address}
                </span>
              </div>
            </div>
          </div>
        </section>

        {phoneInfo && (
          <CallWidget
            phone={phoneInfo.phone}
            displayPhone={phoneInfo.displayPhone}
            variant="light"
          />
        )}

        {/* Преимущества */}
        <section className="px-6 py-20 border-t border-black/[0.04]">
          <div className="max-w-[1200px] mx-auto">
            <h2
              className="font-[family-name:var(--font-manrope)] font-[500] text-[#1d1d1f] mb-10"
              style={{ fontSize: "clamp(26px, 3.2vw, 36px)", letterSpacing: "-1px" }}
            >
              Почему у нас спокойно за авто
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {info.features.map((f, i) => (
                <div
                  key={f.title}
                  className="bg-[#f5f5f7] rounded-2xl p-6 hover:bg-[#efeff1] transition-colors"
                >
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center mb-4"
                    style={{ backgroundColor: `${ACCENT}18`, color: ACCENT }}
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d={FEATURE_ICONS[i % FEATURE_ICONS.length]} />
                    </svg>
                  </div>
                  <h3 className="font-[family-name:var(--font-manrope)] font-semibold text-[#1d1d1f] text-lg mb-1">
                    {f.title}
                  </h3>
                  <p className="text-[#86868b] font-[family-name:var(--font-inter)] text-sm leading-relaxed">
                    {f.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Прайс */}
        <section id="price" className="px-6 py-20 border-t border-black/[0.04]">
          <div className="max-w-[900px] mx-auto">
            <h2
              className="font-[family-name:var(--font-manrope)] font-[500] text-[#1d1d1f]"
              style={{ fontSize: "clamp(26px, 3.2vw, 36px)", letterSpacing: "-1px" }}
            >
              Прайс
            </h2>
            <p className="text-[#86868b] font-[family-name:var(--font-inter)] text-sm mt-3">
              Ночной тариф — {pricing.nightWindow}. При более длительном хранении действует суточная ставка.
            </p>

            {/* Desktop table */}
            <div className="hidden sm:block mt-8 overflow-hidden rounded-2xl border border-black/[0.06]">
              <table className="w-full text-sm font-[family-name:var(--font-inter)]">
                <thead className="bg-[#f5f5f7] text-[#86868b]">
                  <tr>
                    <th className="text-left px-6 py-4 font-medium">Транспорт</th>
                    <th className="text-right px-6 py-4 font-medium">Ночь ({pricing.nightWindow})</th>
                    <th className="text-right px-6 py-4 font-medium">Далее, сутки</th>
                  </tr>
                </thead>
                <tbody className="text-[#1d1d1f]">
                  {pricing.tariffs.map((t, i) => (
                    <tr key={t.vehicle} className={i > 0 ? "border-t border-black/[0.04]" : ""}>
                      <td className="px-6 py-4 font-medium">{t.vehicle}</td>
                      <td className="px-6 py-4 text-right tabular-nums">{fmt(t.nightPrice)}</td>
                      <td className="px-6 py-4 text-right tabular-nums">{fmt(t.dayPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="sm:hidden mt-8 grid gap-4">
              {pricing.tariffs.map((t) => (
                <div key={t.vehicle} className="bg-[#f5f5f7] rounded-2xl p-5 font-[family-name:var(--font-inter)]">
                  <div className="font-[family-name:var(--font-manrope)] font-semibold text-[#1d1d1f] mb-3">
                    {t.vehicle}
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-xs text-[#86868b] mb-1">Ночь</div>
                      <div className="text-[#1d1d1f] tabular-nums">{fmt(t.nightPrice)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-[#86868b] mb-1">Сутки</div>
                      <div className="text-[#1d1d1f] tabular-nums">{fmt(t.dayPrice)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Как это работает */}
        <section className="px-6 py-20 border-t border-black/[0.04]">
          <div className="max-w-[1200px] mx-auto">
            <h2
              className="font-[family-name:var(--font-manrope)] font-[500] text-[#1d1d1f] mb-10"
              style={{ fontSize: "clamp(26px, 3.2vw, 36px)", letterSpacing: "-1px" }}
            >
              Как это работает
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {info.steps.map((s, i) => (
                <div key={s.title} className="relative">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center font-[family-name:var(--font-manrope)] font-semibold text-sm mb-4"
                    style={{ backgroundColor: ACCENT, color: "white" }}
                  >
                    {i + 1}
                  </div>
                  <h3 className="font-[family-name:var(--font-manrope)] font-semibold text-[#1d1d1f] mb-1">
                    {s.title}
                  </h3>
                  <p className="text-[#86868b] font-[family-name:var(--font-inter)] text-sm leading-relaxed">
                    {s.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Как добраться */}
        <section className="px-6 py-20 border-t border-black/[0.04]">
          <div className="max-w-[1200px] mx-auto">
            <div className="mb-8">
              <h2
                className="font-[family-name:var(--font-manrope)] font-[500] text-[#1d1d1f]"
                style={{ fontSize: "clamp(26px, 3.2vw, 36px)", letterSpacing: "-1px" }}
              >
                Как добраться
              </h2>
              <p className="text-[#86868b] font-[family-name:var(--font-inter)] text-sm mt-3">
                {info.address} · 30 км от Москвы по Киевскому шоссе.
              </p>
            </div>
            <YandexMap
              lat={PARK_LAT}
              lon={PARK_LON}
              zoom={16}
              title="Охраняемая автостоянка — бизнес-парк «Деловой», Селятино"
              theme="light"
              className="aspect-[16/9] min-h-[420px]"
              ctaLabel="Построить маршрут"
            />
          </div>
        </section>

        {/* CTA */}
        <section className="px-6 pb-24">
          <div className="max-w-[1200px] mx-auto">
            <div
              className="rounded-3xl px-8 py-14 text-center"
              style={{ backgroundColor: `${ACCENT}12` }}
            >
              <h2
                className="font-[family-name:var(--font-manrope)] font-[500] text-[#1d1d1f]"
                style={{ fontSize: "clamp(24px, 3vw, 34px)", letterSpacing: "-1px" }}
              >
                Нужно оставить машину?
              </h2>
              <p className="text-[#4b4b4f] font-[family-name:var(--font-inter)] text-base mt-3 max-w-xl mx-auto">
                Позвоните — подскажем свободные места и ответим на вопросы. Или заезжайте сразу, площадка работает круглосуточно.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3 mt-8">
                {phoneInfo && (
                  <a
                    href={`tel:${phoneInfo.phone}`}
                    className="inline-flex items-center gap-2 bg-[#1d1d1f] text-white font-[family-name:var(--font-manrope)] font-medium text-sm px-6 py-3.5 rounded-full hover:bg-black transition-colors"
                  >
                    Позвонить {phoneInfo.displayPhone}
                  </a>
                )}
                <Link
                  href="/gazebos"
                  className="inline-flex items-center gap-2 font-[family-name:var(--font-inter)] font-medium text-sm px-6 py-3.5 rounded-full bg-white text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors"
                >
                  Барбекю Парк
                </Link>
              </div>
            </div>
          </div>
        </section>

        <Footer />
      </div>
    </>
  );
}
