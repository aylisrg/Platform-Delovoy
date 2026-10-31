import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import { headers } from "next/headers";
import { listResources, isPublicBookingEnabled, getMinBookingHours } from "@/modules/gazebos/service";
import { getPublicPhone } from "@/modules/telephony/service";
import { BookOnlineButton, StickyBookingCta } from "@/components/public/gazebos/booking-cta";
import { GazeboList, GazeboNumberLinks } from "@/components/public/gazebos/gazebo-list";
import styles from "@/components/public/gazebos/gazebos.module.css";
import { getGazeboWorkingHours } from "@/components/public/gazebos/gazebo-presentation";
import { BookingFlow } from "@/components/public/gazebos/booking-flow";
import { PricingSection } from "@/components/public/gazebos/pricing-section";
import { ParkingSection } from "@/components/public/gazebos/parking-section";
import { CallWidget } from "@/components/public/call-widget";
import { Navbar } from "@landing/components/navbar";
import { Footer } from "@landing/components/footer";
import { deriveSessionKeyFromHeaders, isPrefetchOrBot, recordFunnelStep } from "@/modules/analytics/product-events";
import { PARK_LOCATION } from "@/lib/park-location";
import { PUBLIC_CONTACTS } from "@/lib/public-contacts";

export const dynamic = "force-dynamic";

const APP_URL = "https://delovoy-park.ru";

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Главная", item: APP_URL },
        { "@type": "ListItem", position: 2, name: "Барбекю Парк", item: `${APP_URL}/gazebos` },
      ],
    },
    {
      "@type": "LocalBusiness",
      "@id": `${APP_URL}/gazebos`,
      name: "Барбекю Парк — Деловой Парк",
      description: "Комфортные беседки с мангальной зоной до 20 человек. Онлайн-бронирование. Дрова, уголь, зона отдыха.",
      url: `${APP_URL}/gazebos`,
      telephone: PUBLIC_CONTACTS.gazebos.phone,
      address: {
        "@type": "PostalAddress",
        addressLocality: "Селятино",
        addressRegion: "Московская область",
        addressCountry: "RU",
      },
      geo: {
        "@type": "GeoCoordinates",
        latitude: PARK_LOCATION.lat,
        longitude: PARK_LOCATION.lon,
      },
      openingHoursSpecification: [
        {
          "@type": "OpeningHoursSpecification",
          dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
          // Режим работы по п. 3.4 оферты и Приложению № 1.
          opens: "11:00",
          closes: "22:30",
        },
      ],
      hasOfferCatalog: {
        "@type": "OfferCatalog",
        name: "Беседки с мангалом",
        itemListElement: [
          {
            "@type": "Offer",
            name: "Аренда беседки",
            description: "Беседка с мангальной зоной до 20 человек. Дрова, уголь, зона отдыха.",
            priceCurrency: "RUB",
            priceSpecification: {
              "@type": "UnitPriceSpecification",
              unitText: "час",
            },
          },
        ],
      },
      potentialAction: {
        "@type": "ReserveAction",
        target: `${APP_URL}/gazebos`,
        result: { "@type": "Reservation", name: "Бронирование беседки" },
      },
    },
  ],
};

export const metadata: Metadata = {
  title: "Барбекю Парк",
  description:
    "Барбекю Парк в бизнес-парке Деловой, Селятино. Комфортные беседки до 20 человек. Онлайн-бронирование. Мангал, дрова, зона отдыха.",
  alternates: {
    canonical: "/gazebos",
  },
  openGraph: {
    title: "Барбекю Парк — Деловой Парк",
    description: "Барбекю Парк — беседки с мангалом до 20 человек. Селятино, Московская область. Онлайн-бронирование.",
    url: "/gazebos",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
};

export default async function GazebosPage() {
  const headersList = await headers();
  if (!isPrefetchOrBot(headersList)) {
    // First-party воронка (US-1 эпика #583, ADR 2026-09-16).
    after(() => {
      recordFunnelStep({ funnel: "gazebos", step: "view", sessionKey: deriveSessionKeyFromHeaders(headersList) });
    });
  }

  const [resources, phoneInfo, bookingEnabled, minBookingHours] = await Promise.all([
    listResources(true),
    getPublicPhone("gazebos"),
    isPublicBookingEnabled(),
    getMinBookingHours(),
  ]);

  const workingHours = getGazeboWorkingHours(resources);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className={styles.page}>
        <Navbar collapseAt="xl" action={bookingEnabled
          ? { href: "#booking", label: "Забронировать" }
          : { href: "#gazebo-help", label: "Помочь с выбором" }} />

        <main>
          <div className={styles.introSurface}>
          <section className={`${styles.container} ${styles.intro}`} aria-labelledby="gazebos-heading">
            <nav className={styles.breadcrumbs} aria-label="Хлебные крошки">
              <Link href="/">Главная</Link><span aria-hidden="true">/</span>
              <span aria-current="page">Барбекю Парк</span>
            </nav>
            <h1 id="gazebos-heading" className={styles.title}>Барбекю Парк</h1>
            <p className={styles.tagline}>Своя беседка. Своя компания.</p>
            <p className={styles.introText}>Выберите номер, посмотрите фотографии и забронируйте время.</p>
            <div className={styles.introActions}>
              {bookingEnabled && <BookOnlineButton source="hero" className={styles.textLink}>Забронировать онлайн →</BookOnlineButton>}
              {phoneInfo && <a href={`tel:${phoneInfo.phone}`} data-testid="hero-phone" className={styles.textLink}>{phoneInfo.displayPhone}</a>}
            </div>
          </section>

            <div className={`${styles.container} ${styles.selectionBar}`}>
              <GazeboNumberLinks resources={resources} />
              <p className={styles.hours}>{workingHours && <>{workingHours} · </>}Минимум {minBookingHours} ч</p>
            </div>
          </div>
          <section className={`${styles.container} ${styles.selection}`} aria-label="Беседки и фотографии">
            <GazeboList resources={resources} bookingEnabled={bookingEnabled} minBookingHours={minBookingHours}>
              <aside id="gazebo-help" className={styles.help} aria-labelledby="gazebo-help-title">
                <h2 id="gazebo-help-title">Нужна помощь с выбором?</h2>
                <p>Подскажем, какая беседка подойдёт вашей компании, и поможем с бронью.</p>
                <h3>Как забронировать</h3>
                <ol className={styles.steps}>
                  <li><span aria-hidden="true">1</span>Выберите беседку по фото</li>
                  <li><span aria-hidden="true">2</span>Укажите дату и время</li>
                  <li><span aria-hidden="true">3</span>Проверьте детали и подтвердите бронь</li>
                </ol>
                {phoneInfo
                  ? <a href={`tel:${phoneInfo.phone}`} className={styles.primaryButton}>{phoneInfo.displayPhone}</a>
                  : <Link href="/#contacts" className={styles.primaryButton}>Связаться с нами</Link>}
              </aside>
            </GazeboList>
          </section>

        <section id="booking" className={styles.bookingSection} aria-label="Бронирование беседки">
          <div className={styles.container}>
          <div className={styles.bookingInner}>
            {bookingEnabled ? (
              <BookingFlow />
            ) : (
              <div className="rounded-2xl border border-black/[0.06] bg-zinc-50 px-6 py-12 text-center">
                <h2 className="font-[family-name:var(--font-manrope)] font-medium text-zinc-900 text-2xl">
                  Онлайн-бронирование временно недоступно
                </h2>
                <p className="text-zinc-500 font-[family-name:var(--font-inter)] text-base mt-3 max-w-md mx-auto leading-relaxed">
                  Мы принимаем брони по телефону. Позвоните нам — поможем выбрать
                  беседку и подберём время.
                </p>
                {phoneInfo && (
                  <a
                    href={`tel:${phoneInfo.phone}`}
                    className={`${styles.primaryButton} mt-6`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.5a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2.69h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9.4a16 16 0 0 0 6.29 6.29l.94-.94a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                    </svg>
                    {phoneInfo.displayPhone}
                  </a>
                )}
              </div>
            )}
          </div>
          </div>
        </section>

        {/* Call widget */}
        {phoneInfo && (
          <CallWidget
            phone={phoneInfo.phone}
            displayPhone={phoneInfo.displayPhone}
            variant="light"
          />
        )}

        {/* Pricing & extras */}
        <PricingSection resources={resources} />

        {/* Автостоянка */}
        <ParkingSection />
        </main>

        {/* Sticky CTA на мобиле (~70px) не должен перекрывать низ футера (#1085). */}
        <div data-testid="footer-wrap" className={bookingEnabled ? "pb-24 md:pb-0" : undefined}>
          <Footer />
        </div>
        {bookingEnabled && <StickyBookingCta />}
      </div>
    </>
  );
}
