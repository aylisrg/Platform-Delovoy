export function Footer() {
  return (
    <footer className="bg-black border-t border-white/5 px-6 py-10">
      <div className="max-w-[1200px] mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        <p className="font-[family-name:var(--font-manrope)] font-semibold text-white text-sm tracking-tight">
          Деловой Парк
        </p>
        <p className="text-[#a6a6a6] text-xs font-[family-name:var(--font-inter)]">
          Селятино, Московская область
        </p>
        <p className="text-[#a6a6a6]/40 text-xs font-[family-name:var(--font-inter)]">
          © {new Date().getFullYear()} Деловой Парк
        </p>
      </div>
    </footer>
  );
}
