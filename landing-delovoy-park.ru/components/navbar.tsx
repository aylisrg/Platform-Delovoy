"use client";

import { useState } from "react";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";

const navLinks = [
  { label: "О парке", href: "#advantages" },
  { label: "Офисы", href: "#offices" },
  { label: "Беседки", href: "/gazebos" },
  { label: "Услуги", href: "#services" },
  { label: "Контакты", href: "#contacts" },
];

export function Navbar() {
  const [open, setOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const { data: session, status } = useSession();

  const isLoggedIn = status === "authenticated" && !!session?.user;
  const isAdmin =
    session?.user?.role === "SUPERADMIN" || session?.user?.role === "MANAGER";

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-xl border-b border-black/[0.04]">
      <div className="max-w-[1200px] mx-auto px-6 h-14 flex items-center justify-between">
        {/* Logo */}
        <Link
          href="/"
          className="font-[family-name:var(--font-manrope)] font-semibold text-[#1d1d1f] text-[17px] tracking-tight"
        >
          Деловой Парк
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-7">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-[#1d1d1f]/70 hover:text-[#1d1d1f] transition-colors text-[13px] font-[family-name:var(--font-inter)] font-medium"
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* Right side: CTA + Auth */}
        <div className="hidden md:flex items-center gap-3">
          <a
            href="#offices"
            className="inline-flex items-center bg-[#0071e3] hover:bg-[#0077ED] text-white text-[13px] px-5 py-2 rounded-full transition-all font-[family-name:var(--font-inter)] font-medium"
          >
            Оставить заявку
          </a>

          {status !== "loading" && (
            isLoggedIn ? (
              <div className="relative">
                <button
                  onClick={() => setUserMenu(!userMenu)}
                  className="inline-flex items-center gap-2 text-[#1d1d1f]/60 hover:text-[#1d1d1f] text-[13px] px-4 py-2 rounded-full border border-black/[0.08] hover:border-black/[0.15] transition-all font-[family-name:var(--font-inter)]"
                >
                  {session.user.image ? (
                    <img
                      src={session.user.image}
                      alt=""
                      className="w-5 h-5 rounded-full"
                    />
                  ) : (
                    <div className="w-5 h-5 rounded-full bg-[#f5f5f7] flex items-center justify-center text-[10px] font-medium text-[#1d1d1f]">
                      {(session.user.name || "U")[0].toUpperCase()}
                    </div>
                  )}
                  {session.user.name?.split(" ")[0] || "Кабинет"}
                </button>

                {userMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setUserMenu(false)} />
                    <div className="absolute right-0 top-full mt-2 w-48 bg-white border border-black/[0.08] rounded-xl overflow-hidden shadow-lg z-50">
                      <Link
                        href={isAdmin ? "/admin/dashboard" : "/dashboard"}
                        onClick={() => setUserMenu(false)}
                        className="block px-4 py-2.5 text-[13px] text-[#1d1d1f]/80 hover:text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors font-[family-name:var(--font-inter)]"
                      >
                        {isAdmin ? "Админ-панель" : "Личный кабинет"}
                      </Link>
                      <button
                        onClick={() => signOut({ callbackUrl: "/" })}
                        className="block w-full text-left px-4 py-2.5 text-[13px] text-red-500 hover:text-red-600 hover:bg-[#f5f5f7] transition-colors font-[family-name:var(--font-inter)]"
                      >
                        Выйти
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <Link
                href="/auth/signin"
                className="text-[#1d1d1f]/50 hover:text-[#1d1d1f] text-[13px] px-4 py-2 transition-colors font-[family-name:var(--font-inter)]"
              >
                Войти
              </Link>
            )
          )}
        </div>

        {/* Mobile burger */}
        <button
          className="md:hidden text-[#1d1d1f] p-2"
          onClick={() => setOpen(!open)}
          aria-label="Меню"
        >
          <div className="w-[18px] h-px bg-[#1d1d1f] mb-1.5" />
          <div className="w-[18px] h-px bg-[#1d1d1f] mb-1.5" />
          <div className="w-[18px] h-px bg-[#1d1d1f]" />
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden bg-white/95 backdrop-blur-xl border-t border-black/[0.04] px-6 py-5 space-y-4">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="block text-[#1d1d1f]/70 hover:text-[#1d1d1f] transition-colors text-[15px] font-[family-name:var(--font-inter)]"
            >
              {link.label}
            </a>
          ))}
          <a
            href="#offices"
            onClick={() => setOpen(false)}
            className="block w-full text-center bg-[#0071e3] text-white text-[15px] px-5 py-3 rounded-full font-medium font-[family-name:var(--font-inter)]"
          >
            Оставить заявку
          </a>

          {status !== "loading" && (
            isLoggedIn ? (
              <div className="flex items-center justify-between pt-3 border-t border-black/[0.04]">
                <Link
                  href={isAdmin ? "/admin/dashboard" : "/dashboard"}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 text-[#1d1d1f]/60 text-[15px] font-[family-name:var(--font-inter)]"
                >
                  {session.user.image ? (
                    <img src={session.user.image} alt="" className="w-5 h-5 rounded-full" />
                  ) : (
                    <div className="w-5 h-5 rounded-full bg-[#f5f5f7] flex items-center justify-center text-[10px] font-medium text-[#1d1d1f]">
                      {(session.user.name || "U")[0].toUpperCase()}
                    </div>
                  )}
                  {session.user.name || "Личный кабинет"}
                </Link>
                <button
                  onClick={() => signOut({ callbackUrl: "/" })}
                  className="text-red-500 hover:text-red-600 text-[15px] font-[family-name:var(--font-inter)] transition-colors"
                >
                  Выйти
                </button>
              </div>
            ) : (
              <Link
                href="/auth/signin"
                onClick={() => setOpen(false)}
                className="block text-[#1d1d1f]/50 hover:text-[#1d1d1f] text-[15px] font-[family-name:var(--font-inter)]"
              >
                Войти
              </Link>
            )
          )}
        </div>
      )}
    </header>
  );
}
