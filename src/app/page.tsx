import type { Metadata } from "next";
import { Navbar } from "@landing/components/navbar";
import { HeroSectionWithVideo } from "@landing/components/hero-section-with-video";
import { OfficesSection } from "@landing/components/offices-section";
import { ServicesSection } from "@landing/components/services-section";
import { AdvantagesSection } from "@landing/components/advantages-section";
import { ReviewsSection } from "@landing/components/reviews-section";
import { ContactsSection } from "@landing/components/contacts-section";
import { Footer } from "@landing/components/footer";
import { FadeInSection } from "@/components/ui/fade-in-section";

export const metadata: Metadata = {
  title: "Деловой Парк — Бизнес-парк в Селятино",
  description:
    "Бизнес-парк Деловой в Селятино, Московская область. Аренда офисов от 15 м², Барбекю Парк с мангалом, Плей Парк, кафе с доставкой. 300+ отзывов ★★★★★ на Яндекс Картах.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Деловой Парк — Бизнес-парк в Селятино",
    description:
      "Аренда офисов от 15 м², Барбекю Парк с мангалом, Плей Парк, кафе. Селятино, Московская область.",
    url: "/",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "@id": "https://delovoy-park.ru",
  name: "Деловой Парк",
  alternateName: "Бизнес-парк Деловой",
  description:
    "Бизнес-парк в Селятино, Московская область. Аренда офисов, Барбекю Парк с мангалом, Плей Парк, кафе.",
  url: "https://delovoy-park.ru",
  telephone: process.env.DELOVOY_PHONE || "+7-000-000-00-00",
  address: {
    "@type": "PostalAddress",
    streetAddress: "Промышленная ул., 1",
    addressLocality: "пгт Селятино",
    addressRegion: "Московская область",
    postalCode: "143345",
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
      dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      opens: "08:00",
      closes: "20:00",
    },
    {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: ["Saturday", "Sunday"],
      opens: "10:00",
      closes: "18:00",
    },
  ],
  hasOfferCatalog: {
    "@type": "OfferCatalog",
    name: "Услуги бизнес-парка",
    itemListElement: [
      {
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: "Аренда офисов",
          description: "Офисы от 15 м² с готовой отделкой, интернетом и парковкой",
        },
      },
      {
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: "Барбекю Парк",
          description: "Комфортные беседки до 20 человек с мангальной зоной",
        },
      },
      {
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: "Плей Парк",
          description: "Аренда PlayStation 5 по часам",
        },
      },
      {
        "@type": "Offer",
        itemOffered: {
          "@type": "FoodEstablishment",
          name: "Кафе",
          description: "Кафе с доставкой в офис",
        },
      },
    ],
  },
  aggregateRating: {
    "@type": "AggregateRating",
    ratingValue: "5",
    bestRating: "5",
    ratingCount: "280",
  },
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="bg-white min-h-screen">
        <Navbar />
        <HeroSectionWithVideo />
        <OfficesSection />
        <FadeInSection delay={0}>
          <ServicesSection />
        </FadeInSection>
        <FadeInSection delay={0.05}>
          <AdvantagesSection />
        </FadeInSection>
        <FadeInSection delay={0.05}>
          <ReviewsSection />
        </FadeInSection>
        <FadeInSection delay={0.05}>
          <ContactsSection />
        </FadeInSection>
        <Footer />
      </div>
    </>
  );
}
