const services = [
  {
    id: "gazebos",
    title: "Беседки",
    description:
      "Уютные беседки с мангалом и террасой на природе. Идеально для командного обеда, встречи с партнёрами или просто отдыха.",
    cta: "Забронировать",
    href: "/gazebos",
    accent: "#16A34A",
  },
  {
    id: "ps-park",
    title: "PS Park",
    description:
      "PlayStation 5 и PS4, комфортные кресла, большие экраны. Корпоративные турниры, командный отдых, геймерские вечера.",
    cta: "Забронировать",
    href: "/ps-park",
    accent: "#7C3AED",
  },
  {
    id: "cafe",
    title: "Кафе",
    description:
      "Горячая еда, кофе и закуски с доставкой прямо в офис. Работает каждый день — завтраки, обеды, перекусы.",
    cta: "Посмотреть меню",
    href: "/cafe",
    accent: "#EA580C",
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
              className="bg-white rounded-2xl p-7 flex flex-col gap-5 group hover:shadow-lg transition-all"
            >
              {/* Colored dot */}
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{ backgroundColor: `${s.accent}14` }}
              >
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: s.accent }}
                />
              </div>

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

              {/* Photo placeholder */}
              <div className="w-full h-36 rounded-xl bg-[#f5f5f7] flex items-center justify-center">
                <span className="text-[#86868b]/30 text-xs font-[family-name:var(--font-inter)]">
                  фото
                </span>
              </div>

              <a
                href={s.href}
                className="inline-flex items-center justify-center text-white text-[14px] font-medium px-5 py-2.5 rounded-full transition-all font-[family-name:var(--font-inter)]"
                style={{ backgroundColor: s.accent }}
              >
                {s.cta}
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
