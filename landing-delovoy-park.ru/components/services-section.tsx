const services = [
  {
    id: "gazebos",
    title: "Беседки",
    description:
      "Уютные беседки с мангалом и террасой на природе. Идеально для командного обеда, встречи с партнёрами или просто отдыха.",
    cta: "Забронировать",
    href: "/gazebos",
    accent: "#16A34A",
    emoji: "🌿",
  },
  {
    id: "ps-park",
    title: "PS Park",
    description:
      "PlayStation 5 и PS4, комфортные кресла, большие экраны. Корпоративные турниры, командный отдых, геймерские вечера.",
    cta: "Забронировать",
    href: "/ps-park",
    accent: "#7C3AED",
    emoji: "🎮",
  },
  {
    id: "cafe",
    title: "Кафе",
    description:
      "Горячая еда, кофе и закуски с доставкой прямо в офис. Работает каждый день — завтраки, обеды, перекусы.",
    cta: "Посмотреть меню",
    href: "/cafe",
    accent: "#EA580C",
    emoji: "☕",
  },
];

export function ServicesSection() {
  return (
    <section id="services" className="bg-black py-24 px-6">
      <div className="max-w-[1200px] mx-auto">
        <div className="mb-14">
          <h2
            className="font-[family-name:var(--font-manrope)] font-[500] text-white"
            style={{
              fontSize: "clamp(40px, 6vw, 72px)",
              letterSpacing: "clamp(-1.5px, -0.04em, -3px)",
              lineHeight: 0.95,
            }}
          >
            Всё для работы
            <br />
            и отдыха.
          </h2>
          <p className="text-[#a6a6a6] font-[family-name:var(--font-inter)] text-base mt-4 max-w-md">
            Три сервиса на территории парка — бронируйте онлайн в любое время.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {services.map((s) => (
            <div
              key={s.id}
              className="bg-black rounded-[16px] p-7 flex flex-col gap-5 border border-white/5 group hover:border-white/10 transition-colors"
              style={{
                boxShadow: "rgba(0, 153, 255, 0.06) 0px 0px 0px 1px",
              }}
            >
              {/* Icon placeholder */}
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
                style={{ backgroundColor: `${s.accent}18` }}
              >
                {s.emoji}
              </div>

              <div className="flex-1">
                <h3
                  className="font-[family-name:var(--font-manrope)] font-semibold text-white text-xl mb-2"
                  style={{ letterSpacing: "-0.4px" }}
                >
                  {s.title}
                </h3>
                <p className="text-[#a6a6a6] text-sm font-[family-name:var(--font-inter)] leading-relaxed">
                  {s.description}
                </p>
              </div>

              {/* Photo placeholder */}
              <div className="w-full h-36 rounded-xl bg-white/[0.03] border border-white/5 flex items-center justify-center">
                <span className="text-[#a6a6a6]/30 text-xs font-[family-name:var(--font-inter)]">
                  фото
                </span>
              </div>

              <a
                href={s.href}
                className="inline-flex items-center justify-center text-white text-sm font-medium px-5 py-2.5 rounded-full transition-all font-[family-name:var(--font-inter)]"
                style={{
                  backgroundColor: `${s.accent}20`,
                  border: `1px solid ${s.accent}40`,
                }}
              >
                {s.cta} →
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
