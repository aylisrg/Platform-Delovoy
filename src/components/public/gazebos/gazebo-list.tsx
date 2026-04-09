import type { GazeboResource } from "@/modules/gazebos/types";

const ACCENT = "#16A34A";

type Props = {
  resources: GazeboResource[];
};

export function GazeboList({ resources }: Props) {
  if (resources.length === 0) {
    return (
      <p className="text-white/30 font-[family-name:var(--font-inter)] text-sm">
        Беседки пока не добавлены
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {resources.map((resource) => (
        <div
          key={resource.id}
          className="bg-black rounded-[16px] p-7 flex flex-col gap-4 border border-white/5 group hover:border-white/10 transition-colors"
          style={{ boxShadow: "rgba(0, 153, 255, 0.06) 0px 0px 0px 1px" }}
        >
          {/* Icon */}
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
            style={{ backgroundColor: `${ACCENT}18` }}
          >
            🌿
          </div>

          <div className="flex-1">
            <h3
              className="font-[family-name:var(--font-manrope)] font-semibold text-white text-xl mb-1"
              style={{ letterSpacing: "-0.4px" }}
            >
              {resource.name}
            </h3>
            {resource.description && (
              <p className="text-[#a6a6a6] text-sm font-[family-name:var(--font-inter)] leading-relaxed">
                {resource.description}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-3 text-sm font-[family-name:var(--font-inter)]">
            {resource.capacity && (
              <span className="text-white/40">
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
