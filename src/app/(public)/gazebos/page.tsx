import type { Metadata } from "next";
import Link from "next/link";
import { listResources } from "@/modules/gazebos/service";
import { getPublicPhone } from "@/modules/telephony/service";
import { GazeboList } from "@/components/public/gazebos/gazebo-list";
import { BookingFlow } from "@/components/public/gazebos/booking-flow";
import { PricingSection } from "@/components/public/gazebos/pricing-section";
import { CallWidget } from "@/components/public/call-widget";
import { Navbar } from "@landing/components/navbar";
import { Footer } from "@landing/components/footer";

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
      address: {
        "@type": "PostalAddress",
        addressLocality: "Селятино",
        addressRegion: "Московская область",
        addressCountry: "RU",
      },
      geo: {
        "@type": "GeoCoordinates",
        latitude: 55.519479,
        longitude: 36.978566,
      },
      openingHoursSpecification: [
        {
          "@type": "OpeningHoursSpecification",
          dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
          opens: "10:00",
          closes: "22:00",
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
  const [resources, phoneInfo] = await Promise.all([
    listResources(true),
    getPublicPhone("gazebos"),
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="bg-white min-h-screen">
        <Navbar />

        {/* Hero with video background */}
        <section className="relative h-[70vh] min-h-[500px] flex items-end overflow-hidden">
          {/* Video background */}
          {/* Desktop: autoplay video */}
          <video
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            poster="/media/IMG_3724_Custom.JPG.webp"
            className="absolute inset-0 w-full h-full object-cover hidden md:block"
          >
            <source src="/media/gazebo.mp4" type="video/mp4" />
          </video>
          {/* Mobile: static poster fallback */}
          <div
            className="absolute inset-0 md:hidden bg-zinc-800"
            style={{ backgroundImage: "url('/media/IMG_3724_Custom.JPG.webp')", backgroundSize: "cover", backgroundPosition: "center" }}
          />
          {/* Overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-black/10" />

          {/* Content */}
          <div className="relative z-10 max-w-[1200px] mx-auto w-full px-6 pb-16">
            <Link
              href="/"
              className="text-white/70 hover:text-white text-sm font-[family-name:var(--font-inter)] transition-colors"
            >
              ← Главная
            </Link>
            <h1
              className="font-[family-name:var(--font-manrope)] font-[500] text-white mt-6"
              style={{
                fontSize: "clamp(36px, 5vw, 56px)",
                letterSpacing: "clamp(-1px, -0.03em, -2px)",
                lineHeight: 0.95,
              }}
            >
              Барбекю Парк
            </h1>
            <p className="text-white/70 font-[family-name:var(--font-inter)] text-base mt-5 max-w-lg leading-relaxed">
              Беседки с мангалом. Запах шашлыка, друзья рядом — это и есть план.
              Забронируйте онлайн в пару кликов.
            </p>
            {phoneInfo && (
              <div className="flex items-center gap-3 mt-6">
                <a
                  href={`tel:${phoneInfo.phone}`}
                  className="inline-flex items-center gap-2 bg-white text-black font-[family-name:var(--font-manrope)] font-medium text-sm px-4 py-2.5 rounded-full hover:bg-white/90 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.5a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2.69h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9.4a16 16 0 0 0 6.29 6.29l.94-.94a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                  Позвонить
                </a>
                <span className="text-white/80 font-[family-name:var(--font-inter)] text-sm">
                  {phoneInfo.displayPhone}
                </span>
              </div>
            )}
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

        {/* Gazebo cards */}
        <section className="px-6 pb-20">
          <div className="max-w-[1200px] mx-auto">
            <GazeboList resources={resources} />
          </div>
        </section>

        {/* Pricing & extras */}
        <PricingSection />

        {/* Booking flow */}
        <section className="px-6 pb-24 border-t border-black/[0.04] pt-20">
          <div className="max-w-[800px] mx-auto">
            <BookingFlow />
          </div>
        </section>

        <Footer />
      </div>
    </>
  );
}
