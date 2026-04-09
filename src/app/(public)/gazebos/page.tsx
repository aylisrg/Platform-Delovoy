import Link from "next/link";
import { listResources } from "@/modules/gazebos/service";
import { GazeboList } from "@/components/public/gazebos/gazebo-list";
import { BookingFlow } from "@/components/public/gazebos/booking-flow";
import { Navbar } from "@landing/components/navbar";
import { Footer } from "@landing/components/footer";

export const dynamic = "force-dynamic";

export default async function GazebosPage() {
  const resources = await listResources(true);

  return (
    <div className="bg-black min-h-screen">
      <Navbar />

      {/* Hero */}
      <section className="pt-36 pb-20 px-6">
        <div className="max-w-[1200px] mx-auto">
          <Link
            href="/"
            className="text-[#0099ff] hover:text-[#0099ff]/80 text-sm font-[family-name:var(--font-inter)] transition-colors"
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
            Беседки
          </h1>
          <p className="text-[#a6a6a6] font-[family-name:var(--font-inter)] text-base mt-5 max-w-lg leading-relaxed">
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
      <section className="px-6 pb-24 border-t border-white/5 pt-20">
        <div className="max-w-[800px] mx-auto">
          <BookingFlow />
        </div>
      </section>

      <Footer />
    </div>
  );
}
