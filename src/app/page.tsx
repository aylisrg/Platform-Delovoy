import type { Metadata } from "next";
import { Navbar } from "@landing/components/navbar";

export const metadata: Metadata = {
  title: "Деловой Парк — Бизнес-парк в Селятино",
  description:
    "Бизнес-парк Деловой в Селятино, Московская область. Аренда офисов от 15 м², беседки с мангалом, PlayStation Park, кафе с доставкой. 300+ отзывов ★★★★★ на Яндекс Картах.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Деловой Парк — Бизнес-парк в Селятино",
    description:
      "Аренда офисов от 15 м², беседки с мангалом, PlayStation Park, кафе. Селятино, Московская область.",
    url: "/",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
};
import { HeroSectionWithVideo } from "@landing/components/hero-section-with-video";
import { OfficesSection } from "@landing/components/offices-section";
import { ServicesSection } from "@landing/components/services-section";
import { AdvantagesSection } from "@landing/components/advantages-section";
import { ReviewsSection } from "@landing/components/reviews-section";
import { ContactsSection } from "@landing/components/contacts-section";
import { Footer } from "@landing/components/footer";

export default function Home() {
  return (
    <div className="bg-white min-h-screen">
      <Navbar />
      <HeroSectionWithVideo />
      <OfficesSection />
      <ServicesSection />
      <AdvantagesSection />
      <ReviewsSection />
      <ContactsSection />
      <Footer />
    </div>
  );
}
