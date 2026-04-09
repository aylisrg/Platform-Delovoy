import { WaitlistForm } from "./waitlist-form";

const offices = [
  {
    title: "Мини-офис",
    area: "15–25 м²",
    price: "от 15 000 ₽/мес",
    features: ["1–3 рабочих места", "Отдельный вход", "Готов к работе"],
  },
  {
    title: "Стандарт",
    area: "25–40 м²",
    price: "от 25 000 ₽/мес",
    features: ["3–6 мест", "Зона переговоров", "Кухонный уголок"],
  },
  {
    title: "Большой офис",
    area: "40–80 м²",
    price: "от 45 000 ₽/мес",
    features: ["6–15 мест", "Переговорная", "Свой санузел"],
  },
  {
    title: "Этаж",
    area: "80+ м²",
    price: "Договорная",
    features: ["Корпоративное решение", "Планировка под вас", "VIP-условия"],
  },
];

export function OfficesSection() {
  return (
    <section id="offices" className="bg-black py-24 px-6">
      <div className="max-w-[1200px] mx-auto">
        {/* Heading row */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-14">
          <div>
            <h2
              className="font-[family-name:var(--font-manrope)] font-[500] text-white"
              style={{
                fontSize: "clamp(40px, 6vw, 72px)",
                letterSpacing: "clamp(-1.5px, -0.04em, -3px)",
                lineHeight: 0.95,
              }}
            >
              Офисы
            </h2>
            <p className="text-[#a6a6a6] font-[family-name:var(--font-inter)] text-base mt-4 max-w-sm">
              Все помещения сданы. Оставьте заявку — сообщим первыми, когда
              появится место.
            </p>
          </div>

          {/* Sold-out badge */}
          <div className="inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-5 py-2.5 self-start md:self-auto">
            <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
            <span className="text-white text-sm font-medium font-[family-name:var(--font-inter)]">
              Все места заняты
            </span>
          </div>
        </div>

        {/* Office cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-16">
          {offices.map((office) => (
            <div
              key={office.title}
              className="relative bg-black rounded-[12px] p-6 border border-white/5 flex flex-col gap-4"
              style={{
                boxShadow: "rgba(0, 153, 255, 0.08) 0px 0px 0px 1px",
              }}
            >
              {/* СДАН badge */}
              <span className="absolute top-3 right-3 bg-amber-400/10 text-amber-400 text-[10px] font-semibold px-2 py-0.5 rounded-full font-[family-name:var(--font-inter)] uppercase tracking-wide">
                СДАН
              </span>

              {/* Photo placeholder */}
              <div className="w-full h-32 rounded-lg bg-white/[0.03] border border-white/5 flex items-center justify-center">
                <span className="text-[#a6a6a6]/30 text-xs font-[family-name:var(--font-inter)]">
                  фото
                </span>
              </div>

              <div>
                <p className="text-white font-semibold font-[family-name:var(--font-manrope)] text-base">
                  {office.title}
                </p>
                <p className="text-[#a6a6a6] text-sm font-[family-name:var(--font-inter)] mt-0.5">
                  {office.area}
                </p>
              </div>

              <ul className="space-y-1.5">
                {office.features.map((f) => (
                  <li
                    key={f}
                    className="flex items-center gap-2 text-[#a6a6a6] text-xs font-[family-name:var(--font-inter)]"
                  >
                    <span className="w-1 h-1 rounded-full bg-[#0099ff] flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>

              <p className="text-white/60 text-xs font-[family-name:var(--font-inter)] mt-auto pt-2 border-t border-white/5">
                {office.price}
              </p>
            </div>
          ))}
        </div>

        {/* Wait list form */}
        <div className="max-w-md mx-auto">
          <div
            className="bg-black rounded-[16px] p-8 border border-white/5"
            style={{
              boxShadow: "rgba(0, 153, 255, 0.12) 0px 0px 0px 1px",
            }}
          >
            <h3
              className="font-[family-name:var(--font-manrope)] font-semibold text-white text-2xl mb-2"
              style={{ letterSpacing: "-0.5px" }}
            >
              Лист ожидания
            </h3>
            <p className="text-[#a6a6a6] text-sm font-[family-name:var(--font-inter)] mb-6">
              Оставьте заявку — мы свяжемся с вами в первую очередь, когда
              освободится подходящий офис.
            </p>
            <WaitlistForm />
          </div>
        </div>
      </div>
    </section>
  );
}
