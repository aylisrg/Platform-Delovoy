export function HeroSection() {
  return (
    <section className="min-h-screen flex flex-col justify-center bg-black pt-16 px-6">
      <div className="max-w-[1200px] mx-auto w-full py-24 md:py-32">
        {/* Rating badge */}
        <div className="inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-4 py-2 mb-10">
          <span className="text-[#0099ff] text-sm">★★★★★</span>
          <span className="text-[#a6a6a6] text-sm font-[family-name:var(--font-inter)]">
            300+ отзывов на Яндекс Картах
          </span>
        </div>

        {/* Display headline */}
        <h1
          className="font-[family-name:var(--font-manrope)] font-[500] text-white leading-[0.88]"
          style={{
            fontSize: "clamp(52px, 9vw, 110px)",
            letterSpacing: "clamp(-2px, -0.05em, -5.5px)",
          }}
        >
          Бизнес-парк,
          <br />
          которому
          <br />
          <span className="text-[#0099ff]">доверяют.</span>
        </h1>

        {/* Sub */}
        <p className="mt-8 text-[#a6a6a6] font-[family-name:var(--font-inter)] text-lg max-w-xl leading-relaxed">
          Каждый отзыв — 5 звёзд. Это не случайность,
          это&nbsp;то, как мы работаем каждый день.
          <br />
          <span className="text-white/60 text-sm mt-1 block">
            Селятино, Московская область
          </span>
        </p>

        {/* CTAs */}
        <div className="mt-10 flex flex-col sm:flex-row gap-4">
          <a
            href="#offices"
            className="inline-flex items-center justify-center bg-white text-black font-medium text-sm px-8 py-4 rounded-full hover:bg-white/90 transition-all font-[family-name:var(--font-inter)]"
          >
            Записаться в лист ожидания
          </a>
          <a
            href="#services"
            className="inline-flex items-center justify-center bg-white/10 hover:bg-white/15 text-white font-medium text-sm px-8 py-4 rounded-full transition-all font-[family-name:var(--font-inter)]"
          >
            Посмотреть услуги →
          </a>
        </div>

        {/* Stats row */}
        <div className="mt-20 pt-10 border-t border-white/5 grid grid-cols-2 md:grid-cols-4 gap-8">
          {[
            { value: "300+", label: "отзывов ★★★★★" },
            { value: "5.0", label: "средний рейтинг" },
            { value: "50+", label: "офисов в парке" },
            { value: "30 км", label: "от Москвы" },
          ].map((stat) => (
            <div key={stat.label}>
              <p
                className="font-[family-name:var(--font-manrope)] font-semibold text-white text-[36px] leading-tight"
                style={{ letterSpacing: "-1px" }}
              >
                {stat.value}
              </p>
              <p className="text-[#a6a6a6] text-sm font-[family-name:var(--font-inter)] mt-1">
                {stat.label}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
