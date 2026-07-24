import Link from "next/link";
import { YandexMap } from "@/components/ui/yandex-map";
import { getParkingPricing } from "@/modules/parking/service";

const ACCENT = "#16A34A";

// Координаты бизнес-парка «Деловой», Селятино — те же, что на главной странице
// (реальная точка организации на Яндекс.Картах, а не значение из JSON-LD).
const PARK_OID = "165904522406";
const PARK_LAT = 55.516945;
const PARK_LON = 36.978520;

const fmt = (n: number) => n.toLocaleString("ru-RU") + " ₽";

const FEATURES = [
  "Охраняемая территория, круглосуточно",
  "Видеонаблюдение по всему периметру",
  "Места для легкового и грузового транспорта",
];

export function ParkingSection() {
  const pricing = getParkingPricing();

  return (
    <section className="px-6 pb-24 border-t border-black/[0.04] pt-20">
      <div className="max-w-[1200px] mx-auto">
        <div className="mb-10">
          <h2
            className="font-[family-name:var(--font-manrope)] font-[500] text-[#1d1d1f]"
            style={{ fontSize: "clamp(28px, 3.5vw, 40px)", letterSpacing: "-1px", lineHeight: 1 }}
          >
            Хотите оставить авто на ночь?
          </h2>
          <p className="text-[#86868b] font-[family-name:var(--font-inter)] text-base mt-4 max-w-2xl leading-relaxed">
            На нашей охраняемой парковке автомобиль будет под присмотром, пока вы
            отдыхаете в беседке. Видеонаблюдение, освещение, круглосуточный доступ.
            Вот прайс:
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-2 items-start">
          {/* Left: features + price */}
          <div className="font-[family-name:var(--font-inter)]">
            <ul className="space-y-3 mb-8">
              {FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-3 text-sm text-[#1d1d1f]">
                  <span
                    className="mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `${ACCENT}20`, color: ACCENT }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </span>
                  {f}
                </li>
              ))}
            </ul>

            <div className="overflow-hidden rounded-2xl border border-black/[0.06]">
              <table className="w-full text-sm">
                <thead className="bg-[#f5f5f7] text-[#86868b]">
                  <tr>
                    <th className="text-left px-5 py-3.5 font-medium">Транспорт</th>
                    <th className="text-right px-5 py-3.5 font-medium">Ночь ({pricing.nightWindow})</th>
                    <th className="text-right px-5 py-3.5 font-medium">Далее, сутки</th>
                  </tr>
                </thead>
                <tbody className="text-[#1d1d1f]">
                  {pricing.tariffs.map((t, i) => (
                    <tr key={t.vehicle} className={i > 0 ? "border-t border-black/[0.04]" : ""}>
                      <td className="px-5 py-3.5">{t.vehicle}</td>
                      <td className="px-5 py-3.5 text-right tabular-nums">{fmt(t.nightPrice)}</td>
                      <td className="px-5 py-3.5 text-right tabular-nums">{fmt(t.dayPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Link
              href="/avtostoyanka"
              className="inline-flex items-center gap-2 mt-6 text-sm font-medium rounded-full px-5 py-3 transition-colors"
              style={{ backgroundColor: `${ACCENT}15`, color: ACCENT }}
            >
              Подробнее об автостоянке
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>

          {/* Right: map */}
          <YandexMap
            orgId={PARK_OID}
            lat={PARK_LAT}
            lon={PARK_LON}
            zoom={17}
            title="Автостоянка — бизнес-парк «Деловой», Селятино"
            theme="light"
            className="aspect-[4/3] min-h-[360px]"
            ctaLabel="Построить маршрут"
          />
        </div>
      </div>
    </section>
  );
}
