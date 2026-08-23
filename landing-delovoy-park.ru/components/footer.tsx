import { LegalFooterLinks } from "@/components/legal/legal-footer-links";

export function Footer() {
  return (
    <footer className="bg-[#f5f5f7] px-6 py-10">
      <div className="max-w-[1200px] mx-auto flex flex-col gap-5">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="font-[family-name:var(--font-manrope)] font-semibold text-[#1d1d1f] text-sm tracking-tight">
            Деловой Парк
          </p>
          <p className="text-[#86868b] text-xs font-[family-name:var(--font-inter)]">
            Селятино, Московская область
          </p>
          <p className="text-[#86868b]/50 text-xs font-[family-name:var(--font-inter)]">
            © {new Date().getFullYear()} Деловой Парк
          </p>
        </div>
        <div className="border-t border-black/[0.06] pt-4 text-center md:text-left">
          <LegalFooterLinks />
        </div>
      </div>
    </footer>
  );
}
