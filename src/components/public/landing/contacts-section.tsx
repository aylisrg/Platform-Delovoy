const contacts = [
  {
    type: "Телефон",
    value: "+7 (XXX) XXX-XX-XX",
    href: "tel:+7XXXXXXXXXX",
    icon: "📞",
  },
  {
    type: "Telegram",
    value: "@delovoy_park",
    href: "https://t.me/delovoy_park",
    icon: "✈️",
  },
  {
    type: "WhatsApp",
    value: "+7 (XXX) XXX-XX-XX",
    href: "https://wa.me/7XXXXXXXXXX",
    icon: "💬",
  },
];

export function ContactsSection() {
  return (
    <section id="contacts" className="bg-black py-24 px-6 border-t border-white/5">
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
            Как нас
            <br />
            найти.
          </h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Map */}
          <div
            className="rounded-[16px] overflow-hidden border border-white/5"
            style={{ minHeight: "360px" }}
          >
            {/*
              ЗАМЕНИТЬ на реальный Yandex Maps embed:
              <iframe
                src="https://yandex.ru/map-widget/v1/?..."
                width="100%"
                height="100%"
                frameBorder="0"
                allowFullScreen
              />
            */}
            <div className="w-full h-full min-h-[360px] bg-white/[0.02] flex flex-col items-center justify-center gap-3">
              <span className="text-4xl">📍</span>
              <p className="text-[#a6a6a6] text-sm font-[family-name:var(--font-inter)] text-center px-4 max-w-xs leading-relaxed">
                Московская область,
                <br />
                Наро-Фоминский р-н,
                <br />
                д. Селятино
              </p>
              <a
                href="https://yandex.ru/maps/?text=Деловой+Парк+Селятино"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 text-[#0099ff] text-sm font-[family-name:var(--font-inter)] hover:underline"
              >
                Открыть на Яндекс Картах →
              </a>
            </div>
          </div>

          {/* Contacts */}
          <div className="flex flex-col justify-center gap-5">
            <div className="mb-2">
              <p className="text-[#a6a6a6] text-sm font-[family-name:var(--font-inter)] max-w-sm leading-relaxed">
                40 км от Москвы по Киевскому шоссе.
                Бесплатная парковка на территории.
              </p>
            </div>

            <div className="space-y-3">
              {contacts.map((c) => (
                <a
                  key={c.type}
                  href={c.href}
                  target={c.href.startsWith("http") ? "_blank" : undefined}
                  rel={c.href.startsWith("http") ? "noopener noreferrer" : undefined}
                  className="flex items-center gap-4 p-4 rounded-[12px] border border-white/5 hover:border-white/10 transition-colors group"
                  style={{
                    boxShadow: "rgba(0, 153, 255, 0.06) 0px 0px 0px 1px",
                  }}
                >
                  <span className="text-xl flex-shrink-0">{c.icon}</span>
                  <div>
                    <p className="text-[#a6a6a6] text-xs font-[family-name:var(--font-inter)] uppercase tracking-wide">
                      {c.type}
                    </p>
                    <p className="text-white font-medium font-[family-name:var(--font-inter)] text-sm group-hover:text-[#0099ff] transition-colors">
                      {c.value}
                    </p>
                  </div>
                </a>
              ))}
            </div>

            <a
              href="#offices"
              className="mt-4 inline-flex items-center justify-center bg-white text-black font-medium text-sm px-8 py-4 rounded-full hover:bg-white/90 transition-all font-[family-name:var(--font-inter)] self-start"
            >
              Записаться в лист ожидания
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
