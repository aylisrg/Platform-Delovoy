const advantages = [
  {
    icon: "★★★★★",
    title: "300+ отзывов на Яндексе",
    description: "Каждый — пятёрка. Лучший рейтинг среди бизнес-центров района.",
    highlight: true,
  },
  {
    icon: "🅿️",
    title: "Парковка 50+ мест",
    description: "Бесплатно для арендаторов и гостей, без ограничений по времени.",
    highlight: false,
  },
  {
    icon: "🔒",
    title: "Охрана 24/7",
    description: "Видеонаблюдение, охраняемая территория и пропускная система.",
    highlight: false,
  },
  {
    icon: "📶",
    title: "Скоростной интернет",
    description: "Оптоволокно с резервированием — работает без сбоев.",
    highlight: false,
  },
  {
    icon: "🌳",
    title: "Природа рядом",
    description: "Парк, беседки и зелёная зона — редкость для бизнес-центра.",
    highlight: false,
  },
  {
    icon: "📍",
    title: "40 км от Москвы",
    description: "Удобная доступность из Москвы и Новой Москвы по Киевскому шоссе.",
    highlight: false,
  },
];

export function AdvantagesSection() {
  return (
    <section id="advantages" className="bg-black py-24 px-6 border-t border-white/5">
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
            Почему
            <br />
            Деловой?
          </h2>
          <p className="text-[#a6a6a6] font-[family-name:var(--font-inter)] text-base mt-4 max-w-sm">
            То, что ценят арендаторы, которые уже работают здесь годами.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {advantages.map((adv) => (
            <div
              key={adv.title}
              className="rounded-[14px] p-6 border transition-colors"
              style={{
                backgroundColor: adv.highlight ? "rgba(0, 153, 255, 0.04)" : "transparent",
                borderColor: adv.highlight
                  ? "rgba(0, 153, 255, 0.2)"
                  : "rgba(255,255,255,0.06)",
                boxShadow: adv.highlight
                  ? "rgba(0, 153, 255, 0.1) 0px 0px 0px 1px"
                  : "none",
              }}
            >
              <div className="text-2xl mb-4">{adv.icon}</div>
              <h3
                className="font-[family-name:var(--font-manrope)] font-semibold text-white text-base mb-2"
                style={{ letterSpacing: "-0.3px" }}
              >
                {adv.title}
              </h3>
              <p className="text-[#a6a6a6] text-sm font-[family-name:var(--font-inter)] leading-relaxed">
                {adv.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
