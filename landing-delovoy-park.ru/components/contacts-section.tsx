const contacts = [
  {
    type: "Телефон",
    value: "+7 (XXX) XXX-XX-XX",
    href: "tel:+7XXXXXXXXXX",
    icon: "phone",
  },
  {
    type: "Telegram",
    value: "@delovoy_park",
    href: "https://t.me/delovoy_park",
    icon: "telegram",
  },
  {
    type: "WhatsApp",
    value: "+7 (XXX) XXX-XX-XX",
    href: "https://wa.me/7XXXXXXXXXX",
    icon: "whatsapp",
  },
];

export function ContactsSection() {
  return (
    <section id="contacts" className="bg-white py-24 px-6">
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
            Как нас
            <br />
            найти.
          </h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Map */}
          <div
            className="rounded-2xl overflow-hidden bg-[#f5f5f7]"
            style={{ minHeight: "360px" }}
          >
            <div className="w-full h-full min-h-[360px] flex flex-col items-center justify-center gap-3">
              <div className="w-12 h-12 rounded-full bg-[#0071e3]/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-[#0071e3]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <p className="text-[#86868b] text-sm font-[family-name:var(--font-inter)] text-center px-4 max-w-xs leading-relaxed">
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
                className="mt-2 text-[#0071e3] text-sm font-[family-name:var(--font-inter)] hover:underline"
              >
                Открыть на Яндекс Картах →
              </a>
            </div>
          </div>

          {/* Contacts */}
          <div className="flex flex-col justify-center gap-5">
            <div className="mb-2">
              <p className="text-[#86868b] text-sm font-[family-name:var(--font-inter)] max-w-sm leading-relaxed">
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
                  className="flex items-center gap-4 p-4 rounded-2xl bg-[#f5f5f7] hover:bg-[#ebebed] transition-colors group"
                >
                  <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center flex-shrink-0">
                    <span className="text-[#1d1d1f] text-sm font-medium">
                      {c.type[0]}
                    </span>
                  </div>
                  <div>
                    <p className="text-[#86868b] text-xs font-[family-name:var(--font-inter)] uppercase tracking-wide">
                      {c.type}
                    </p>
                    <p className="text-[#1d1d1f] font-medium font-[family-name:var(--font-inter)] text-sm group-hover:text-[#0071e3] transition-colors">
                      {c.value}
                    </p>
                  </div>
                </a>
              ))}
            </div>

            <a
              href="#offices"
              className="mt-4 inline-flex items-center justify-center bg-[#0071e3] hover:bg-[#0077ED] text-white font-medium text-[15px] px-8 py-4 rounded-full transition-all font-[family-name:var(--font-inter)] self-start"
            >
              Записаться в лист ожидания
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
