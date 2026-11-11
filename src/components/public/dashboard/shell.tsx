import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Navbar } from "@landing/components/navbar";
import { LegalFooterLinks } from "@/components/legal/legal-footer-links";
import { TeamLink } from "@/components/public/team/team-link";

export const dashboardSections = [
  ["overview", "Обзор"],
  ["bookings", "Бронирования"],
  ["orders", "Заказы"],
  ["feedback", "Обращения"],
  ["profile", "Профиль"],
] as const;
export type DashboardSection = (typeof dashboardSections)[number][0];

export function DashboardShell({
  name,
  role,
  section,
  children,
}: {
  name: string | null;
  role: string;
  section: DashboardSection;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#f6f7f9] text-zinc-900">
      <Navbar collapseAt="xl" />
      <header className="border-b border-zinc-200 bg-white pt-14">
        <div className="mx-auto max-w-5xl px-4 pb-6 pt-8 sm:px-6">
          <p className="break-words text-sm text-zinc-600">
            {name ? `Здравствуйте, ${name}` : "Рады вас видеть"}
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            Личный кабинет
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            Ваши планы, заказы и связь с парком.
          </p>
        </div>
      </header>
      <div className="sticky top-14 z-30 border-b border-zinc-200 bg-white/95 backdrop-blur">
        <nav
          aria-label="Разделы личного кабинета"
          className="mx-auto grid max-w-5xl grid-cols-3 gap-1 px-3 py-2 sm:flex sm:px-6"
        >
          {dashboardSections.map(([key, label]) => (
            <Link
              key={key}
              prefetch={false}
              href={
                key === "overview" ? "/dashboard" : `/dashboard?section=${key}`
              }
              aria-current={section === key ? "page" : undefined}
              className={`min-w-0 rounded-xl px-2 py-3 text-center text-xs font-medium focus-visible:outline-2 focus-visible:outline-blue-600 sm:px-5 sm:text-sm ${section === key ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
      <footer className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-zinc-600 sm:px-6">
        <LegalFooterLinks />
        <TeamLink role={role} />
      </footer>
    </div>
  );
}

export function EmptySection({
  title,
  description,
  href,
  action,
}: {
  title: string;
  description: string;
  href: string;
  action: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-6 sm:p-8">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-zinc-600">
        {description}
      </p>
      <Link
        href={href}
        className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white focus-visible:outline-2 focus-visible:outline-blue-600"
      >
        {action}
      </Link>
    </div>
  );
}

export function Pagination({
  page,
  total,
  section,
  history,
}: {
  page: number;
  total: number;
  section: DashboardSection;
  history?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / 10));
  const href = (p: number) =>
    `/dashboard?section=${section}&page=${p}${history ? `&history=${history}` : ""}`;
  if (page > pages) redirect(href(pages));
  return (
    <nav
      aria-label="Страницы списка"
      className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm"
    >
      {page > 1 ? (
        <Link
          className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-blue-700"
          href={href(page - 1)}
        >
          ← Назад
        </Link>
      ) : (
        <span />
      )}
      <p className="text-zinc-600">
        Страница {page} из {pages} · Всего {total}
      </p>
      {page < pages ? (
        <Link
          className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-blue-700"
          href={href(page + 1)}
        >
          Далее →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
