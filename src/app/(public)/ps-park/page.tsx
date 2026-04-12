import type { Metadata } from "next";
import Link from "next/link";
import { listTables, getAvailability } from "@/modules/ps-park/service";
import { getPublicPhone } from "@/modules/telephony/service";
import { DarkAvailabilityGrid } from "@/components/public/ps-park/dark-availability-grid";
import type { PSTableResource } from "@/modules/ps-park/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "PlayStation Park",
  description:
    "PlayStation Park в бизнес-парке Деловой, Селятино. PS5, FIFA, гоночные симуляторы. Аренда столов с PlayStation по часам. Онлайн-бронирование.",
  alternates: {
    canonical: "/ps-park",
  },
  openGraph: {
    title: "PlayStation Park — Деловой Парк",
    description: "Аренда PS5 по часам. Селятино, Московская область. Онлайн-бронирование столов.",
    url: "/ps-park",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
};

function TableCard({ resource, index }: { resource: PSTableResource; index: number }) {
  // Photo placeholder — will use real images once added to /public/media/ps-park/
  const photoPath = `/media/ps-park/table-${index + 1}.jpg`;

  return (
    <div className="group rounded-2xl overflow-hidden border border-zinc-800 bg-zinc-900 hover:border-violet-500/50 transition-all hover:shadow-xl hover:shadow-violet-900/20">
      {/* Photo slot */}
      <div className="relative w-full aspect-[4/3] bg-zinc-800 overflow-hidden">
        <img
          src={photoPath}
          alt={resource.name}
          className="w-full h-full object-cover opacity-0 group-hover:opacity-100 transition-opacity"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
        {/* Placeholder shown when no photo */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          {/* PS controller icon */}
          <svg
            className="w-10 h-10 text-zinc-700"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M14.235 2.19c-.897-.264-1.822-.38-2.735-.38-2.82 0-5.5 1.16-7.5 3.16C2 7.02 1 9.4 1 12c0 2.6 1 4.98 2.78 6.78.48.47 1 .87 1.56 1.2V12c0-1.1.9-2 2-2h1V8a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v2h1c1.1 0 2 .9 2 2v2h-2v-2H7.34v5.22C8.73 18.39 10.35 19 12 19c1.83 0 3.61-.67 5-1.9V12a2 2 0 0 0-2-2h-1V8a1 1 0 0 0-1-1h-1V5a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v2h1a4 4 0 0 1 4 4v5.1c1.57-1.8 2.5-4.13 2.5-6.6a9.47 9.47 0 0 0-4.315-7.81z" />
          </svg>
          <span className="text-zinc-700 text-xs font-medium">
            /media/ps-park/table-{index + 1}.jpg
          </span>
        </div>
        {/* Gradient overlay for text readability */}
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-transparent to-transparent" />
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

// Photo gallery placeholder
function PhotoGallery() {
  const photos = [
    { file: "gallery-1.jpg", label: "Игровая зона" },
    { file: "gallery-2.jpg", label: "PS5 крупный план" },
    { file: "gallery-3.jpg", label: "Атмосфера" },
    { file: "gallery-4.jpg", label: "Интерьер" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {photos.map((photo, i) => (
        <div
          key={i}
          className="relative aspect-square rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800 group"
        >
          <img
            src={`/media/ps-park/${photo.file}`}
            alt={photo.label}
            className="w-full h-full object-cover opacity-0 group-hover:opacity-100 transition-opacity"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
          {/* Placeholder overlay */}
          <div className="absolute inset-0 flex flex-col items-end justify-end p-3">
            <span className="text-zinc-700 text-[10px] font-mono">/media/ps-park/{photo.file}</span>
          </div>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 rounded-full border-2 border-dashed border-zinc-700 flex items-center justify-center">
              <svg className="w-4 h-4 text-zinc-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default async function PSParkPage() {
  const today = new Date().toISOString().split("T")[0];
  const [tables, initialAvailability, phoneInfo] = await Promise.all([
    listTables(true),
    getAvailability(today),
    getPublicPhone("ps-park"),
  ]);

  return (
    <div className="min-h-screen bg-zinc-950 text-white">

      {/* ── HERO ── */}
      <section className="relative overflow-hidden">
        {/* Background grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
        {/* Purple glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] rounded-full bg-violet-600/10 blur-[120px] pointer-events-none" />

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
            PlayStation
            <br />
            <span
              className="text-transparent bg-clip-text"
              style={{ backgroundImage: "linear-gradient(135deg, #a855f7, #6366f1)" }}
            >
              Park
            </span>
          </h1>

          <p className="mt-6 text-zinc-400 font-[family-name:var(--font-inter)] text-lg max-w-lg leading-relaxed">
            PS5, большой экран, кресло как дома. Приходи — мы не осудим, если немного прогуливаешь работу.
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
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.5a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2.69h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9.4a16 16 0 0 0 6.29 6.29l.94-.94a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
                Позвонить
                <span className="text-zinc-400 text-sm">{phoneInfo.displayPhone}</span>
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

      {/* ── PHOTO GALLERY ── */}
      <section className="max-w-6xl mx-auto px-4 pb-16">
        <PhotoGallery />
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
          <p className="text-zinc-600 py-8">Консоли ещё в пути. Скоро тут будет шум и победные кричалки.</p>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
                desc: "Минимум час. Но ты же знаешь, что час — это «ещё одна игра».",
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
            PlayStation Park · Бизнес-парк Деловой, Селятино
          </p>
          <Link href="/" className="text-zinc-500 hover:text-zinc-300 text-sm transition-colors">
            ← На главную
          </Link>
        </div>
      </footer>
    </div>
  );
}
