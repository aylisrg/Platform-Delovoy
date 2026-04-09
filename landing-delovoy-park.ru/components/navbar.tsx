"use client";

import { useState } from "react";
import Link from "next/link";

const navLinks = [
  { label: "О парке", href: "#advantages" },
  { label: "Офисы", href: "#offices" },
  { label: "Услуги", href: "#services" },
  { label: "Контакты", href: "#contacts" },
];

export function Navbar() {
  const [open, setOpen] = useState(false);

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

        {/* CTA */}
        <a
          href="#offices"
          className="hidden md:inline-flex items-center bg-white/10 hover:bg-white/20 text-white text-sm px-5 py-2 rounded-full transition-all font-[family-name:var(--font-inter)] font-medium"
        >
          Записаться в лист ожидания
        </a>

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
        </div>
      )}
    </header>
  );
}
