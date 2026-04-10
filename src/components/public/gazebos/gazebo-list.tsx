import type { GazeboResource } from "@/modules/gazebos/types";

const ACCENT = "#16A34A";

type Props = {
  resources: GazeboResource[];
};

export function GazeboList({ resources }: Props) {
  if (resources.length === 0) {
    return (
      <p className="text-[#86868b]/50 font-[family-name:var(--font-inter)] text-sm">
        Беседки пока не добавлены
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {resources.map((resource) => (
        <div
          key={resource.id}
          className="bg-[#f5f5f7] rounded-2xl p-7 flex flex-col gap-4 group hover:bg-[#ebebed] transition-colors"
        >
          {/* Icon */}
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: ACCENT }}
          />

          <div className="flex-1">
            <h3
              className="font-[family-name:var(--font-manrope)] font-semibold text-[#1d1d1f] text-xl mb-1"
              style={{ letterSpacing: "-0.4px" }}
            >
              {resource.name}
            </h3>
            {resource.description && (
              <p className="text-[#86868b] text-sm font-[family-name:var(--font-inter)] leading-relaxed">
                {resource.description}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-3 text-sm font-[family-name:var(--font-inter)]">
            {resource.capacity && (
              <span className="text-[#86868b]">
                до {resource.capacity} чел.
              </span>
            )}
            {resource.pricePerHour && (
              <span
                className="font-medium px-2.5 py-0.5 rounded-full text-xs"
                style={{ backgroundColor: `${ACCENT}20`, color: ACCENT }}
              >
                {Number(resource.pricePerHour)} ₽/час
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
