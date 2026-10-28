import Link from "next/link";
import { LegalFooterLinks } from "@/components/legal/legal-footer-links";
import { PUBLIC_CONTACTS } from "@/lib/public-contacts";

export function Footer() {
  return (
    <footer className="bg-[#f5f5f7] px-6 py-10">
      <div className="max-w-[1200px] mx-auto flex flex-col gap-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Object.values(PUBLIC_CONTACTS).map((contact) => (
            <div key={contact.phone}>
              <p className="text-[#86868b] text-xs mb-1">{contact.label}</p>
              <a
                href={`tel:${contact.phone}`}
                className="inline-block py-2 text-sm text-[#1d1d1f] hover:text-[#0071e3] transition-colors whitespace-nowrap"
              >
                {contact.displayPhone}
              </a>
            </div>
          ))}
        </div>
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="font-[family-name:var(--font-manrope)] font-semibold text-[#1d1d1f] text-sm tracking-tight">
            Деловой Парк
          </p>
          <p className="text-[#86868b] text-xs font-[family-name:var(--font-inter)]">
            Селятино, Московская область
          </p>
          {/* Вход во внутренние сервисы: страница сама уводит на
              /auth/signin с callbackUrl и возвращает обратно. */}
          <Link
            href="/for-team"
            className="text-[#86868b] hover:text-[#1d1d1f] text-xs tracking-[0.12em] uppercase font-[family-name:var(--font-inter)] font-semibold transition-colors"
          >
            For team
          </Link>
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
