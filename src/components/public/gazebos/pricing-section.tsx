const ACCENT = "#16A34A";

type Row = {
  name: string;
  capacity: string;
  weekdayHour: number;
  weekdayDay: number;
  weekendHour: number;
  weekendDay: number;
  note?: string;
};

const PRICES: Row[] = [
  { name: "Беседка №1", capacity: "до 20 чел.", weekdayHour: 1100, weekdayDay: 11000, weekendHour: 1400, weekendDay: 14000 },
  { name: "Беседки №2, 3, 4", capacity: "до 12 чел.", weekdayHour: 800, weekdayDay: 7000, weekendHour: 1000, weekendDay: 10000 },
  { name: "Беседка №5", capacity: "до 30 чел.", weekdayHour: 1400, weekdayDay: 13000, weekendHour: 1900, weekendDay: 16000, note: "интернет + ТВ" },
];

const EXTRAS: Array<{ name: string; price: string }> = [
  { name: "Уголь, 3 кг", price: "400 ₽" },
  { name: "Розжиг, 0,5 л", price: "200 ₽" },
  { name: "Дрова, 6 шт", price: "300 ₽" },
  { name: "Решётка для гриля", price: "300 ₽" },
  { name: "Набор шампуров, 6 шт", price: "300 ₽" },
  { name: "Комплект одноразовой посуды", price: "150 ₽" },
  { name: "Вентилятор", price: "300 ₽" },
  { name: "Обогреватель", price: "300 ₽" },
  { name: "Фризби", price: "500 ₽" },
  { name: "Бадминтон", price: "500 ₽" },
  { name: "Волейбол", price: "1 500 ₽" },
  { name: "Мини-футбол", price: "2 000 ₽" },
  { name: "Караоке", price: "750 ₽/час" },
];

const fmt = (n: number) => n.toLocaleString("ru-RU") + " ₽";

export function PricingSection() {
  return (
    <section className="px-6 pb-24 border-t border-black/[0.04] pt-20">
      <div className="max-w-[1200px] mx-auto">
        <div className="mb-10">
          <h2
            className="font-[family-name:var(--font-manrope)] font-[500] text-[#1d1d1f]"
            style={{ fontSize: "clamp(28px, 3.5vw, 40px)", letterSpacing: "-1px", lineHeight: 1 }}
          >
            Прайс на аренду
          </h2>
          <p className="text-[#86868b] font-[family-name:var(--font-inter)] text-sm mt-3">
            Цены действуют с 28.04.2026. Время работы беседок: 11:00–22:30.
          </p>
        </div>

        {/* Desktop table */}
        <div className="hidden md:block overflow-hidden rounded-2xl border border-black/[0.06]">
          <table className="w-full text-sm font-[family-name:var(--font-inter)]">
            <thead className="bg-[#f5f5f7] text-[#86868b]">
              <tr>
                <th className="text-left px-5 py-4 font-medium">Беседка</th>
                <th className="text-left px-5 py-4 font-medium">Вместимость</th>
                <th className="text-right px-5 py-4 font-medium">Пн–Чт, час</th>
                <th className="text-right px-5 py-4 font-medium">Пн–Чт, день</th>
                <th className="text-right px-5 py-4 font-medium">Пт–Вс, час</th>
                <th className="text-right px-5 py-4 font-medium">Пт–Вс, день</th>
              </tr>
            </thead>
            <tbody className="text-[#1d1d1f]">
              {PRICES.map((row, i) => (
                <tr key={row.name} className={i > 0 ? "border-t border-black/[0.04]" : ""}>
                  <td className="px-5 py-4">
                    <div className="font-medium">{row.name}</div>
                    {row.note && (
                      <div className="text-xs text-[#86868b] mt-0.5">{row.note}</div>
                    )}
                  </td>
                  <td className="px-5 py-4 text-[#86868b]">{row.capacity}</td>
                  <td className="px-5 py-4 text-right tabular-nums">{fmt(row.weekdayHour)}</td>
                  <td className="px-5 py-4 text-right tabular-nums">{fmt(row.weekdayDay)}</td>
                  <td className="px-5 py-4 text-right tabular-nums">{fmt(row.weekendHour)}</td>
                  <td className="px-5 py-4 text-right tabular-nums">{fmt(row.weekendDay)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden grid grid-cols-1 gap-4">
          {PRICES.map((row) => (
            <div key={row.name} className="bg-[#f5f5f7] rounded-2xl p-5 font-[family-name:var(--font-inter)]">
              <div className="flex items-baseline justify-between gap-3 mb-3">
                <div>
                  <div className="font-[family-name:var(--font-manrope)] font-semibold text-[#1d1d1f]">
                    {row.name}
                  </div>
                  {row.note && <div className="text-xs text-[#86868b] mt-0.5">{row.note}</div>}
                </div>
                <span className="text-xs text-[#86868b]">{row.capacity}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs text-[#86868b] mb-1">Пн–Чт</div>
                  <div className="text-[#1d1d1f] tabular-nums">{fmt(row.weekdayHour)} / час</div>
                  <div className="text-[#86868b] tabular-nums text-xs">{fmt(row.weekdayDay)} / день</div>
                </div>
                <div>
                  <div className="text-xs text-[#86868b] mb-1">Пт–Вс</div>
                  <div className="text-[#1d1d1f] tabular-nums">{fmt(row.weekendHour)} / час</div>
                  <div className="text-[#86868b] tabular-nums text-xs">{fmt(row.weekendDay)} / день</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Extras */}
        <div className="mt-16">
          <h3
            className="font-[family-name:var(--font-manrope)] font-[500] text-[#1d1d1f] mb-2"
            style={{ fontSize: "clamp(22px, 2.4vw, 28px)", letterSpacing: "-0.5px" }}
          >
            Дополнительные услуги
          </h3>
          <p className="text-[#86868b] font-[family-name:var(--font-inter)] text-sm mb-6">
            Можно добавить к любому бронированию.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {EXTRAS.map((e) => (
              <div
                key={e.name}
                className="flex items-center justify-between gap-4 px-5 py-3.5 bg-[#f5f5f7] rounded-xl font-[family-name:var(--font-inter)] text-sm"
              >
                <span className="text-[#1d1d1f]">{e.name}</span>
                <span
                  className="font-medium tabular-nums whitespace-nowrap px-2.5 py-0.5 rounded-full text-xs"
                  style={{ backgroundColor: `${ACCENT}20`, color: ACCENT }}
                >
                  {e.price}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
