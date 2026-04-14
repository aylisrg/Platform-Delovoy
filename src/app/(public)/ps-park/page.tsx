import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { listTables, getAvailability } from "@/modules/ps-park/service";
import { getPublicPhone } from "@/modules/telephony/service";
import { DarkAvailabilityGrid } from "@/components/public/ps-park/dark-availability-grid";
import { CyberpunkGrid } from "@/components/public/ps-park/cyberpunk-grid";
import { Navbar } from "@landing/components/navbar";
import type { PSTableResource } from "@/modules/ps-park/types";
import type { DayAvailability } from "@/modules/ps-park/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Плей Парк",
  description:
    "Плей Парк в бизнес-парке Деловой, Селятино. PS5, FIFA, гоночные симуляторы. Аренда столов с PlayStation по часам. Онлайн-бронирование.",
  alternates: {
    canonical: "/ps-park",
  },
  openGraph: {
    title: "Плей Парк — Деловой Парк",
    description: "Аренда PS5 по часам. Селятино, Московская область. Онлайн-бронирование столов.",
    url: "/ps-park",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
};

/** Convert Prisma Decimal objects to plain numbers so Client Components can receive them */
function serializeAvailability(availability: DayAvailability[]): DayAvailability[] {
  return availability.map((item) => ({
    ...item,
    resource: {
      ...item.resource,
      pricePerHour: item.resource.pricePerHour != null
        ? (Number(item.resource.pricePerHour) as unknown as typeof item.resource.pricePerHour)
        : null,
    },
  }));
}

const TABLE_PHOTOS = [
  "/media/ps-park/IMG_4358.jpeg",
  "/media/ps-park/IMG_4362.jpeg",
  "/media/ps-park/IMG_4366.jpeg",
  "/media/ps-park/IMG_4368.jpeg",
  "/media/ps-park/IMG_4369.jpeg",
];

function TableCard({ resource, index }: { resource: PSTableResource; index: number }) {
  const photo = TABLE_PHOTOS[index % TABLE_PHOTOS.length];

  return (
    <div className="rounded-2xl overflow-hidden border border-zinc-800 bg-zinc-900 hover:border-violet-500/50 transition-all hover:shadow-xl hover:shadow-violet-900/20 group">
      {/* Photo */}
      <div className="relative w-full aspect-[4/3] bg-zinc-800 overflow-hidden">
        <Image
          src={photo}
          alt={resource.name}
          fill
          className="object-cover transition-transform duration-500 group-hover:scale-105"
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          quality={75}
        />
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-zinc-900 to-transparent" />
      </div>

      {/* Card content */}
      <div className="p-5">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3
            className="font-[family-name:var(--font-manrope)] font-semibold text-white text-lg leading-tight"
            style={{ letterSpacing: "-0.3px" }}
          >
            {resource.name}
          </h3>
          {resource.pricePerHour && (
            <span className="shrink-0 text-sm font-bold text-violet-400 bg-violet-500/10 border border-violet-500/20 rounded-full px-3 py-1">
              {Number(resource.pricePerHour)} ₽/ч
            </span>
          )}
        </div>

        {resource.description && (
          <p className="text-zinc-400 text-sm leading-relaxed mb-3">{resource.description}</p>
        )}

        <div className="flex items-center gap-3 text-xs text-zinc-500">
          {resource.capacity && (
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0" />
              </svg>
              до {resource.capacity} игроков
            </span>
          )}
          <span className="flex items-center gap-1 text-emerald-500">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
            Доступен
          </span>
        </div>
      </div>
    </div>
  );
}

export default async function PSParkPage() {
  const today = new Date().toISOString().split("T")[0];
  const [tables, rawAvailability, phoneInfo] = await Promise.all([
    listTables(true),
    getAvailability(today),
    getPublicPhone("ps-park"),
  ]);

  // Serialize Decimal → number so the Client Component can receive plain objects
  const initialAvailability = serializeAvailability(rawAvailability);

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <Navbar />
      <div className="pt-14">

      {/* ── HERO ── */}
      <section className="relative overflow-hidden">
        {/* Background photo — IMG_4364 */}
        <div className="absolute inset-0">
          <Image
            src="/media/ps-park/IMG_4364.jpeg"
            alt=""
            fill
            priority
            className="object-cover object-center"
            sizes="100vw"
            quality={80}
          />
          {/* Dark overlay so text stays readable and grid shows through */}
          <div className="absolute inset-0 bg-zinc-950/75" />
          <div className="absolute inset-0 bg-gradient-to-b from-zinc-950/40 via-transparent to-zinc-950" />
        </div>
        {/* Animated cyberpunk grid */}
        <div className="absolute inset-0">
          <CyberpunkGrid />
        </div>
        {/* Purple glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] rounded-full bg-violet-600/15 blur-[120px] pointer-events-none" />

        <div className="relative max-w-6xl mx-auto px-4 pt-10 pb-16 md:pt-16 md:pb-24">
          {/* Back link */}
          <nav className="mb-8">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Главная
            </Link>
          </nav>

          {/* Badge */}
          <div className="inline-flex items-center gap-2 bg-violet-500/10 border border-violet-500/20 rounded-full px-4 py-1.5 mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
            <span className="text-violet-300 text-xs font-medium tracking-wide uppercase">
              Бизнес-парк Деловой
            </span>
          </div>

          {/* Headline */}
          <h1
            className="font-[family-name:var(--font-manrope)] font-bold text-white leading-[0.92]"
            style={{
              fontSize: "clamp(48px, 9vw, 100px)",
              letterSpacing: "clamp(-2px, -0.04em, -5px)",
            }}
          >
            Плей
            <br />
            <span
              className="text-transparent bg-clip-text"
              style={{ backgroundImage: "linear-gradient(135deg, #a855f7, #6366f1)" }}
            >
              Парк
            </span>
          </h1>

          <p className="mt-6 text-zinc-400 font-[family-name:var(--font-inter)] text-lg max-w-lg leading-relaxed">
            PS5, большие экраны, комфортные кресла. Аренда по часам — забронируйте стол прямо сейчас.
          </p>

          {/* CTAs */}
          <div className="mt-8 flex flex-col sm:flex-row gap-3 flex-wrap">
            <a
              href="#booking"
              className="inline-flex items-center justify-center bg-violet-600 hover:bg-violet-500 text-white font-semibold text-[15px] px-8 py-3.5 rounded-full transition-all font-[family-name:var(--font-inter)]"
            >
              Забронировать стол
            </a>
            <a
              href="#tables"
              className="inline-flex items-center justify-center bg-white/[0.06] hover:bg-white/[0.1] text-zinc-200 font-medium text-[15px] px-8 py-3.5 rounded-full transition-all font-[family-name:var(--font-inter)]"
            >
              Посмотреть столы
            </a>
            {phoneInfo && (
              <a
                href={`tel:${phoneInfo.phone}`}
                className="inline-flex items-center gap-2 bg-white/[0.06] hover:bg-white/[0.1] text-zinc-200 font-medium text-[15px] px-6 py-3.5 rounded-full transition-all font-[family-name:var(--font-inter)]"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 014.69 13.5a19.79 19.79 0 01-3.07-8.67A2 2 0 013.6 2.69h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L7.91 9.4a16 16 0 006.29 6.29l.94-.94a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" />
                </svg>
                {phoneInfo.displayPhone}
              </a>
            )}
          </div>

          {/* Stats */}
          <div className="mt-12 pt-8 border-t border-zinc-800 grid grid-cols-3 gap-6 max-w-sm">
            {[
              { value: `${tables.length}`, label: "стола" },
              { value: "60 мин", label: "минимум" },
              { value: "PS5", label: "консоли" },
            ].map((stat) => (
              <div key={stat.label}>
                <p
                  className="font-[family-name:var(--font-manrope)] font-bold text-white text-2xl leading-tight"
                  style={{ letterSpacing: "-0.5px" }}
                >
                  {stat.value}
                </p>
                <p className="text-zinc-600 text-xs mt-0.5">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TABLES ── */}
      <section id="tables" className="max-w-6xl mx-auto px-4 pb-20">
        <div className="mb-8">
          <h2
            className="font-[family-name:var(--font-manrope)] font-bold text-white"
            style={{ fontSize: "clamp(28px, 4vw, 40px)", letterSpacing: "-1px" }}
          >
            Наши столы
          </h2>
          <p className="text-zinc-500 text-sm mt-2">
            Выберите стол и нажмите «Забронировать» ниже
          </p>
        </div>

        {tables.length === 0 ? (
          <p className="text-zinc-600 py-8">Столы пока не добавлены</p>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {tables.map((table, i) => (
              <TableCard key={table.id} resource={table} index={i} />
            ))}
          </div>
        )}
      </section>

      {/* ── FEATURES ── */}
      <section className="border-y border-zinc-800/60 bg-zinc-900/40 py-16">
        <div className="max-w-6xl mx-auto px-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {[
              {
                icon: (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                ),
                title: "Аренда от 1 часа",
                desc: "Минимальная аренда — 60 минут. Оплата по факту.",
              },
              {
                icon: (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                ),
                title: "PlayStation 5",
                desc: "Последнее поколение консолей с широким выбором игр.",
              },
              {
                icon: (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                ),
                title: "Онлайн-бронирование",
                desc: "Выберите время и стол — подтверждение придёт сразу.",
              },
            ].map((f) => (
              <div key={f.title} className="flex gap-4">
                <div className="shrink-0 w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-400">
                  {f.icon}
                </div>
                <div>
                  <h3 className="font-semibold text-white text-sm mb-1">{f.title}</h3>
                  <p className="text-zinc-500 text-sm leading-relaxed">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── BOOKING ── */}
      <section id="booking" className="max-w-6xl mx-auto px-4 py-16">
        <div className="mb-8">
          <h2
            className="font-[family-name:var(--font-manrope)] font-bold text-white"
            style={{ fontSize: "clamp(28px, 4vw, 40px)", letterSpacing: "-1px" }}
          >
            Выберите время
          </h2>
          <p className="text-zinc-500 text-sm mt-2">
            Нажмите на доступные слоты, чтобы выбрать время сеанса
          </p>
        </div>

        <DarkAvailabilityGrid
          initialAvailability={initialAvailability}
          initialDate={today}
        />
      </section>

      {/* ── FOOTER BAR ── */}
      <footer className="border-t border-zinc-800 bg-zinc-900/40">
        <div className="max-w-6xl mx-auto px-4 py-8 flex items-center justify-between gap-4 flex-wrap">
          <p className="text-zinc-600 text-sm">
            Плей Парк · Бизнес-парк Деловой, Селятино
          </p>
          <Link href="/" className="text-zinc-500 hover:text-zinc-300 text-sm transition-colors">
            ← На главную
          </Link>
        </div>
      </footer>
      </div>
    </div>
  );
}
