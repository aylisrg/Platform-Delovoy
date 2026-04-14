"use client";

const services = [
  {
    id: "gazebos",
    title: "Барбекю Парк",
    description:
      "Уютные беседки с мангалом и террасой на природе. Идеально для командного обеда, встречи с партнёрами или просто отдыха на свежем воздухе.",
    cta: "Забронировать",
    href: "/gazebos",
    accent: "#16A34A",
    photos: [
      "/media/IMG_3843-HDR_Custom.JPG.webp",
      "/media/IMG_3874-HDR_Custom.JPG.webp",
      "/media/IMG_3891-HDR_Custom.JPG.webp",
    ],
    coverPhoto: "/media/IMG_3843-HDR_Custom.JPG.webp",
    tag: "Беседки · Мангал · Природа",
  },
  {
    id: "ps-park",
    title: "Плей Парк",
    description:
      "PlayStation 5 и PS4, комфортные кресла, большие экраны. Корпоративные турниры, командный отдых, геймерские вечера.",
    cta: "Забронировать",
    href: "/ps-park",
    accent: "#7C3AED",
    photos: [
      "/media/ps-park/IMG_4358.jpeg",
      "/media/ps-park/IMG_4362.jpeg",
      "/media/ps-park/IMG_4364.jpeg",
    ],
    coverPhoto: "/media/ps-park/IMG_4358.jpeg",
    tag: "PS5 · PS4 · Турниры",
  },
  {
    id: "cafe",
    title: "Кафе",
    description:
      "Горячая еда, кофе и закуски с доставкой прямо в офис. Работает каждый день — завтраки, обеды, перекусы.",
    cta: "Посмотреть меню",
    href: "/cafe",
    accent: "#EA580C",
    photos: [
      "/media/DIKO7530.jpg.webp",
      "/media/IMG_3724_Custom.JPG.webp",
      "/media/IMG_3727_Custom.JPG.webp",
    ],
    coverPhoto: "/media/DIKO7530.jpg.webp",
    tag: "Завтраки · Обеды · Доставка",
  },
];

export function ServicesSection() {
  return (
    <section id="services" className="bg-[#f5f5f7] py-24 px-6">
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
            Всё для работы
            <br />
            и отдыха.
          </h2>
          <p className="text-[#86868b] font-[family-name:var(--font-inter)] text-[15px] mt-4 max-w-md leading-relaxed">
            Три сервиса на территории парка — бронируйте онлайн в любое время.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {services.map((s) => (
            <div
              key={s.id}
              className="bg-white rounded-2xl overflow-hidden flex flex-col group hover:shadow-xl transition-all duration-300"
            >
              {/* Photo */}
              <div className="relative w-full h-52 overflow-hidden bg-[#f5f5f7]">
                <img
                  src={s.coverPhoto}
                  alt={s.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  onError={(e) => {
                    e.currentTarget.parentElement!.style.background = `${s.accent}15`;
                    e.currentTarget.style.display = "none";
                  }}
                />
                {/* Tag overlay */}
                <div className="absolute bottom-3 left-3">
                  <span
                    className="text-[11px] font-semibold font-[family-name:var(--font-inter)] px-2.5 py-1 rounded-full backdrop-blur-sm text-white"
                    style={{ backgroundColor: `${s.accent}cc` }}
                  >
                    {s.tag}
                  </span>
                </div>
              </div>

              {/* Content */}
              <div className="p-6 flex flex-col gap-4 flex-1">
                <div className="flex-1">
                  <h3
                    className="font-[family-name:var(--font-manrope)] font-semibold text-[#1d1d1f] text-xl mb-2"
                    style={{ letterSpacing: "-0.4px" }}
                  >
                    {s.title}
                  </h3>
                  <p className="text-[#86868b] text-[14px] font-[family-name:var(--font-inter)] leading-relaxed">
                    {s.description}
                  </p>
                </div>

                <a
                  href={s.href}
                  className="inline-flex items-center justify-center gap-2 text-white text-[14px] font-medium px-5 py-2.5 rounded-full transition-all font-[family-name:var(--font-inter)] group-hover:opacity-90"
                  style={{ backgroundColor: s.accent }}
                >
                  {s.cta}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 12h14M12 5l7 7-7 7"/>
                  </svg>
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
