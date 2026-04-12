import type { Metadata } from "next";
import Link from "next/link";
import { listResources } from "@/modules/gazebos/service";
import { GazeboList } from "@/components/public/gazebos/gazebo-list";
import { BookingFlow } from "@/components/public/gazebos/booking-flow";
import { Navbar } from "@landing/components/navbar";
import { Footer } from "@landing/components/footer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Беседки с мангалом",
  description:
    "Аренда беседок с мангалом в бизнес-парке Деловой, Селятино. Комфортные беседки до 20 человек. Онлайн-бронирование. Мангал, дрова, зона отдыха.",
  alternates: {
    canonical: "/gazebos",
  },
  openGraph: {
    title: "Беседки с мангалом — Деловой Парк",
    description: "Аренда беседок с мангалом до 20 человек. Селятино, Московская область. Онлайн-бронирование.",
    url: "/gazebos",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
};

export default async function GazebosPage() {
  const resources = await listResources(true);

  return (
    <div className="bg-white min-h-screen">
      <Navbar />

      {/* Hero with video background */}
      <section className="relative h-[70vh] min-h-[500px] flex items-end overflow-hidden">
        {/* Video background */}
        <video
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
        >
          <source src="/media/gazebo.mp4" type="video/mp4" />
        </video>
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
            className="font-[family-name:var(--font-manrope)] font-[500] text-[#1d1d1f] mt-6"
            style={{
              fontSize: "clamp(36px, 5vw, 56px)",
              letterSpacing: "clamp(-1px, -0.03em, -2px)",
              lineHeight: 0.95,
            }}
          >
            Беседки
          </h1>
          <p className="text-white/70 font-[family-name:var(--font-inter)] text-base mt-5 max-w-lg leading-relaxed">
            Уютные беседки с мангалом на территории бизнес-парка Деловой.
            Забронируйте онлайн в пару кликов.
          </p>
        </div>
      </section>

      {/* Gazebo cards */}
      <section className="px-6 pb-20">
        <div className="max-w-[1200px] mx-auto">
          <GazeboList resources={resources} />
        </div>
      </section>

      {/* Booking flow */}
      <section className="px-6 pb-24 border-t border-black/[0.04] pt-20">
        <div className="max-w-[800px] mx-auto">
          <BookingFlow />
        </div>
      </section>

      <Footer />
    </div>
  );
}
