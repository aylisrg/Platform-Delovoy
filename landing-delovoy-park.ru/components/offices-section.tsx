"use client";

import { WaitlistForm } from "./waitlist-form";

const offices = [
  {
    title: "Мини-офис",
    area: "15–25 м²",
    price: "от 15 000 ₽/мес",
    features: ["1–3 рабочих места", "Отдельный вход", "Готов к работе"],
    photo: "/media/IMG_3724_Custom.JPG.webp",
  },
  {
    title: "Стандарт",
    area: "25–40 м²",
    price: "от 25 000 ₽/мес",
    features: ["3–6 мест", "Зона переговоров", "Кухонный уголок"],
    photo: "/media/IMG_3760-HDR_Custom.JPG.webp",
  },
  {
    title: "Большой офис",
    area: "40–80 м²",
    price: "от 45 000 ₽/мес",
    features: ["6–15 мест", "Переговорная", "Свой санузел"],
    photo: "/media/IMG_6141-HDR.JPG.webp",
  },
  {
    title: "Этаж",
    area: "80+ м²",
    price: "Договорная",
    features: ["Корпоративное решение", "Планировка под вас", "VIP-условия"],
    photo: "/media/IMG_6151-HDR.JPG.webp",
  },
];

export function OfficesSection() {
  return (
    <section id="offices" className="bg-white py-24 px-6">
      <div className="max-w-[1200px] mx-auto">
        {/* Heading row */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-14">
          <div>
            <h2
              className="font-[family-name:var(--font-manrope)] font-[600] text-[#1d1d1f]"
              style={{
                fontSize: "clamp(36px, 5vw, 64px)",
                letterSpacing: "clamp(-1px, -0.03em, -2.5px)",
                lineHeight: 1,
              }}
            >
              Офисы
            </h2>
            <p className="text-[#86868b] font-[family-name:var(--font-inter)] text-[15px] mt-4 max-w-sm leading-relaxed">
              Все помещения сданы. Оставьте заявку — сообщим первыми, когда
              появится место.
            </p>
          </div>

          {/* Sold-out badge */}
          <div className="inline-flex items-center gap-2 bg-[#f5f5f7] rounded-full px-5 py-2.5 self-start md:self-auto">
            <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
            <span className="text-[#1d1d1f] text-[13px] font-medium font-[family-name:var(--font-inter)]">
              Все места заняты
            </span>
          </div>
        </div>

        {/* Office cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-16">
          {offices.map((office) => (
            <div
              key={office.title}
              className="relative bg-[#f5f5f7] rounded-2xl overflow-hidden flex flex-col hover:bg-[#ebebed] transition-colors group"
            >
              {/* СДАН badge */}
              <span className="absolute top-3 right-3 z-10 bg-amber-500/90 text-white text-[10px] font-semibold px-2.5 py-1 rounded-full font-[family-name:var(--font-inter)] uppercase tracking-wide backdrop-blur-sm">
                СДАН
              </span>

              {/* Photo */}
              <div className="relative w-full h-36 overflow-hidden bg-[#e5e5e7]">
                <img
                  src={office.photo}
                  alt={office.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  onError={(e) => {
                    e.currentTarget.parentElement!.style.background = "#e5e5e7";
                    e.currentTarget.style.display = "none";
                  }}
                />
              </div>

              <div className="p-5 flex flex-col gap-3 flex-1">
                <div>
                  <p className="text-[#1d1d1f] font-semibold font-[family-name:var(--font-manrope)] text-[15px]">
                    {office.title}
                  </p>
                  <p className="text-[#86868b] text-[13px] font-[family-name:var(--font-inter)] mt-0.5">
                    {office.area}
                  </p>
                </div>

                <ul className="space-y-1.5 flex-1">
                  {office.features.map((f) => (
                    <li
                      key={f}
                      className="flex items-center gap-2 text-[#86868b] text-xs font-[family-name:var(--font-inter)]"
                    >
                      <span className="w-1 h-1 rounded-full bg-[#0071e3] flex-shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>

                <p className="text-[#1d1d1f]/50 text-xs font-[family-name:var(--font-inter)] pt-3 border-t border-black/[0.06]">
                  {office.price}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Wait list form */}
        <div className="max-w-md mx-auto">
          <div className="bg-[#f5f5f7] rounded-2xl p-8">
            <h3
              className="font-[family-name:var(--font-manrope)] font-semibold text-[#1d1d1f] text-2xl mb-2"
              style={{ letterSpacing: "-0.5px" }}
            >
              Лист ожидания
            </h3>
            <p className="text-[#86868b] text-sm font-[family-name:var(--font-inter)] mb-6 leading-relaxed">
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
