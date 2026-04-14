"use client";

import { useState } from "react";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";

const navLinks = [
  { label: "О парке", href: "/#advantages" },
  { label: "Офисы", href: "/rental" },
  { label: "Барбекю Парк", href: "/gazebos" },
  { label: "Плей Парк", href: "/ps-park" },
  { label: "Кафе", href: "/cafe" },
  { label: "Контакты", href: "/#contacts" },
];

export function Navbar({ dark = false }: { dark?: boolean }) {
  const [open, setOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const { data: session, status } = useSession();

  const isLoggedIn = status === "authenticated" && !!session?.user;
  const isAdmin =
    session?.user?.role === "SUPERADMIN" || session?.user?.role === "MANAGER";

  const headerCls = dark
    ? "fixed top-0 left-0 right-0 z-50 backdrop-blur-md bg-zinc-950/50 border-b border-violet-500/[0.18]"
    : "fixed top-0 left-0 right-0 z-50 backdrop-blur-xl bg-white/80 border-b border-black/[0.04]";
  const logoCls = dark
    ? "font-[family-name:var(--font-manrope)] font-semibold text-[17px] tracking-tight text-white"
    : "font-[family-name:var(--font-manrope)] font-semibold text-[17px] tracking-tight text-[#1d1d1f]";
  const linkCls = dark
    ? "transition-colors text-[13px] font-[family-name:var(--font-inter)] font-medium text-white/60 hover:text-white"
    : "transition-colors text-[13px] font-[family-name:var(--font-inter)] font-medium text-[#1d1d1f]/70 hover:text-[#1d1d1f]";
  const ctaBtnCls = dark
    ? "inline-flex items-center text-white text-[13px] px-5 py-2 rounded-full transition-all font-[family-name:var(--font-inter)] font-medium bg-violet-600 hover:bg-violet-500"
    : "inline-flex items-center text-white text-[13px] px-5 py-2 rounded-full transition-all font-[family-name:var(--font-inter)] font-medium bg-[#0071e3] hover:bg-[#0077ED]";
  const userBtnCls = dark
    ? "inline-flex items-center gap-2 text-[13px] px-4 py-2 rounded-full transition-all font-[family-name:var(--font-inter)] text-white/60 hover:text-white border border-white/10 hover:border-white/20"
    : "inline-flex items-center gap-2 text-[13px] px-4 py-2 rounded-full transition-all font-[family-name:var(--font-inter)] text-[#1d1d1f]/60 hover:text-[#1d1d1f] border border-black/[0.08] hover:border-black/[0.15]";
  const avatarCls = dark
    ? "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium bg-white/10 text-white"
    : "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium bg-[#f5f5f7] text-[#1d1d1f]";
  const dropdownCls = dark
    ? "absolute right-0 top-full mt-2 w-48 rounded-xl overflow-hidden shadow-lg z-50 bg-zinc-900 border border-white/[0.08]"
    : "absolute right-0 top-full mt-2 w-48 rounded-xl overflow-hidden shadow-lg z-50 bg-white border border-black/[0.08]";
  const dropdownItemCls = dark
    ? "block px-4 py-2.5 text-[13px] transition-colors font-[family-name:var(--font-inter)] text-white/80 hover:text-white hover:bg-white/[0.06]"
    : "block px-4 py-2.5 text-[13px] transition-colors font-[family-name:var(--font-inter)] text-[#1d1d1f]/80 hover:text-[#1d1d1f] hover:bg-[#f5f5f7]";
  const dropdownLogoutCls = dark
    ? "block w-full text-left px-4 py-2.5 text-[13px] text-red-500 hover:text-red-600 transition-colors font-[family-name:var(--font-inter)] hover:bg-white/[0.06]"
    : "block w-full text-left px-4 py-2.5 text-[13px] text-red-500 hover:text-red-600 transition-colors font-[family-name:var(--font-inter)] hover:bg-[#f5f5f7]";
  const loginCls = dark
    ? "text-white/50 hover:text-white text-[13px] px-4 py-2 transition-colors font-[family-name:var(--font-inter)]"
    : "text-[#1d1d1f]/50 hover:text-[#1d1d1f] text-[13px] px-4 py-2 transition-colors font-[family-name:var(--font-inter)]";
  const burgerCls = dark
    ? "md:hidden min-w-[44px] min-h-[44px] flex items-center justify-center -mr-2 text-white"
    : "md:hidden min-w-[44px] min-h-[44px] flex items-center justify-center -mr-2 text-[#1d1d1f]";
  const barCls = dark ? "w-[18px] h-px bg-white" : "w-[18px] h-px bg-[#1d1d1f]";
  const mobileBgCls = dark
    ? "md:hidden backdrop-blur-xl px-6 py-5 space-y-4 bg-zinc-950/95 border-t border-white/[0.06]"
    : "md:hidden backdrop-blur-xl px-6 py-5 space-y-4 bg-white/95 border-t border-black/[0.04]";
  const mobileLinkCls = dark
    ? "block transition-colors text-[15px] font-[family-name:var(--font-inter)] text-white/70 hover:text-white"
    : "block transition-colors text-[15px] font-[family-name:var(--font-inter)] text-[#1d1d1f]/70 hover:text-[#1d1d1f]";
  const mobileCtaCls = dark
    ? "block w-full text-center text-white text-[15px] px-5 py-3 rounded-full font-medium font-[family-name:var(--font-inter)] bg-violet-600"
    : "block w-full text-center text-white text-[15px] px-5 py-3 rounded-full font-medium font-[family-name:var(--font-inter)] bg-[#0071e3]";
  const mobileDividerCls = dark
    ? "flex items-center justify-between pt-3 border-t border-white/[0.06]"
    : "flex items-center justify-between pt-3 border-t border-black/[0.04]";
  const mobileUserCls = dark
    ? "flex items-center gap-2 text-[15px] font-[family-name:var(--font-inter)] text-white/60"
    : "flex items-center gap-2 text-[15px] font-[family-name:var(--font-inter)] text-[#1d1d1f]/60";
  const mobileLoginCls = dark
    ? "block text-[15px] font-[family-name:var(--font-inter)] text-white/50 hover:text-white"
    : "block text-[15px] font-[family-name:var(--font-inter)] text-[#1d1d1f]/50 hover:text-[#1d1d1f]";

  return (
    <header className={headerCls}>
      <div className="max-w-[1200px] mx-auto px-6 h-14 flex items-center justify-between">
        <Link href="/" className={logoCls}>
          Деловой Парк
        </Link>

        <nav className="hidden md:flex items-center gap-7">
          {navLinks.map((link) =>
            !link.href.startsWith("/") || link.href.startsWith("/#") ? (
              <a key={link.href} href={link.href} className={linkCls}>
                {link.label}
              </a>
            ) : (
              <Link key={link.href} href={link.href} className={linkCls}>
                {link.label}
              </Link>
            ),
          )}
        </nav>

        <div className="hidden md:flex items-center gap-3">
          {!isLoggedIn && (
            <a href="#offices" className={ctaBtnCls}>
              Оставить заявку
            </a>
          )}

          {status !== "loading" &&
            (isLoggedIn ? (
              <div className="relative">
                <button
                  onClick={() => setUserMenu(!userMenu)}
                  className={userBtnCls}
                >
                  {session.user.image ? (
                    <img
                      src={session.user.image}
                      alt=""
                      className="w-5 h-5 rounded-full"
                    />
                  ) : (
                    <div className={avatarCls}>
                      {(session.user.name || "U")[0].toUpperCase()}
                    </div>
                  )}
                  {session.user.name?.split(" ")[0] || "Кабинет"}
                </button>

                {userMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setUserMenu(false)}
                    />
                    <div className={dropdownCls}>
                      <Link
                        href={isAdmin ? "/admin/dashboard" : "/dashboard"}
                        onClick={() => setUserMenu(false)}
                        className={dropdownItemCls}
                      >
                        {isAdmin ? "Админ-панель" : "Личный кабинет"}
                      </Link>
                      <button
                        onClick={() => signOut({ callbackUrl: "/" })}
                        className={dropdownLogoutCls}
                      >
                        Выйти
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <Link href="/auth/signin" className={loginCls}>
                Войти
              </Link>
            ))}
        </div>

        <button
          className={burgerCls}
          onClick={() => setOpen(!open)}
          aria-label="Меню"
        >
          <div className="flex flex-col gap-[5px]">
            <div className={barCls} />
            <div className={barCls} />
            <div className={barCls} />
          </div>
        </button>
      </div>

      {open && (
        <div className={mobileBgCls}>
          {navLinks.map((link) =>
            !link.href.startsWith("/") || link.href.startsWith("/#") ? (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className={mobileLinkCls}
              >
                {link.label}
              </a>
            ) : (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className={mobileLinkCls}
              >
                {link.label}
              </Link>
            ),
          )}
          {!isLoggedIn && (
            <a
              href="#offices"
              onClick={() => setOpen(false)}
              className={mobileCtaCls}
            >
              Оставить заявку
            </a>
          )}

          {status !== "loading" &&
            (isLoggedIn ? (
              <div className={mobileDividerCls}>
                <Link
                  href={isAdmin ? "/admin/dashboard" : "/dashboard"}
                  onClick={() => setOpen(false)}
                  className={mobileUserCls}
                >
                  {session.user.image ? (
                    <img
                      src={session.user.image}
                      alt=""
                      className="w-5 h-5 rounded-full"
                    />
                  ) : (
                    <div className={avatarCls}>
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
                className={mobileLoginCls}
              >
                Войти
              </Link>
            ))}
        </div>
      )}
    </header>
  );
}
