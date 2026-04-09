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
    <header className="fixed top-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-md border-b border-white/5">
      <div className="max-w-[1200px] mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link
          href="/"
          className="font-[family-name:var(--font-manrope)] font-semibold text-white text-lg tracking-tight"
        >
          Деловой Парк
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-8">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-[#a6a6a6] hover:text-white transition-colors text-sm font-[family-name:var(--font-inter)]"
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* Right side: CTA + Auth */}
        <div className="hidden md:flex items-center gap-3">
          <a
            href="#offices"
            className="inline-flex items-center bg-white/10 hover:bg-white/20 text-white text-sm px-5 py-2 rounded-full transition-all font-[family-name:var(--font-inter)] font-medium"
          >
            Записаться в лист ожидания
          </a>

          {status !== "loading" && (
            isLoggedIn ? (
              <div className="relative">
                <button
                  onClick={() => setUserMenu(!userMenu)}
                  className="inline-flex items-center gap-2 text-white/70 hover:text-white text-sm px-4 py-2 rounded-full border border-white/10 hover:border-white/20 transition-all font-[family-name:var(--font-inter)]"
                >
                  {session.user.image ? (
                    <img
                      src={session.user.image}
                      alt=""
                      className="w-5 h-5 rounded-full"
                    />
                  ) : (
                    <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-medium text-white">
                      {(session.user.name || "U")[0].toUpperCase()}
                    </div>
                  )}
                  {session.user.name?.split(" ")[0] || "Кабинет"}
                </button>

                {userMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setUserMenu(false)} />
                    <div className="absolute right-0 top-full mt-2 w-48 bg-[#1a1a1a] border border-white/10 rounded-xl overflow-hidden shadow-xl z-50">
                      <Link
                        href={isAdmin ? "/admin/dashboard" : "/dashboard"}
                        onClick={() => setUserMenu(false)}
                        className="block px-4 py-2.5 text-sm text-white/80 hover:text-white hover:bg-white/5 transition-colors font-[family-name:var(--font-inter)]"
                      >
                        {isAdmin ? "Админ-панель" : "Личный кабинет"}
                      </Link>
                      <button
                        onClick={() => signOut({ callbackUrl: "/" })}
                        className="block w-full text-left px-4 py-2.5 text-sm text-red-400 hover:text-red-300 hover:bg-white/5 transition-colors font-[family-name:var(--font-inter)]"
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
                className="text-white/60 hover:text-white text-sm px-4 py-2 transition-colors font-[family-name:var(--font-inter)]"
              >
                Войти
              </Link>
            )
          )}
        </div>

        {/* Mobile burger */}
        <button
          className="md:hidden text-white p-2"
          onClick={() => setOpen(!open)}
          aria-label="Меню"
        >
          <div className="w-5 h-px bg-white mb-1.5" />
          <div className="w-5 h-px bg-white mb-1.5" />
          <div className="w-5 h-px bg-white" />
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden bg-black border-t border-white/5 px-6 py-4 space-y-4">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="block text-[#a6a6a6] hover:text-white transition-colors text-sm font-[family-name:var(--font-inter)]"
            >
              {link.label}
            </a>
          ))}
          <a
            href="#offices"
            onClick={() => setOpen(false)}
            className="block w-full text-center bg-white text-black text-sm px-5 py-2.5 rounded-full font-medium font-[family-name:var(--font-inter)]"
          >
            Записаться в лист ожидания
          </a>

          {status !== "loading" && (
            isLoggedIn ? (
              <div className="flex items-center justify-between pt-2 border-t border-white/5">
                <Link
                  href={isAdmin ? "/admin/dashboard" : "/dashboard"}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 text-white/70 text-sm font-[family-name:var(--font-inter)]"
                >
                  {session.user.image ? (
                    <img src={session.user.image} alt="" className="w-5 h-5 rounded-full" />
                  ) : (
                    <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-medium text-white">
                      {(session.user.name || "U")[0].toUpperCase()}
                    </div>
                  )}
                  {session.user.name || "Личный кабинет"}
                </Link>
                <button
                  onClick={() => signOut({ callbackUrl: "/" })}
                  className="text-red-400 hover:text-red-300 text-sm font-[family-name:var(--font-inter)] transition-colors"
                >
                  Выйти
                </button>
              </div>
            ) : (
              <Link
                href="/auth/signin"
                onClick={() => setOpen(false)}
                className="block text-white/60 hover:text-white text-sm font-[family-name:var(--font-inter)]"
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
