import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getUserAdminSections } from "@/lib/permissions";
import {
  groupTeamServices,
  isTeamRole,
  visibleTeamServices,
} from "@/lib/team-services";
import { Navbar } from "@landing/components/navbar";
import { Footer } from "@landing/components/footer";

// Страница зависит от сессии — кешировать нельзя.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Для команды",
  description: "Внутренние сервисы бизнес-парка Деловой для сотрудников.",
  // Служебный раздел: в поиске ему делать нечего (ср. /dashboard).
  robots: { index: false, follow: false },
};

const roleLabel: Record<string, string> = {
  SUPERADMIN: "Суперадмин",
  ADMIN: "Администратор",
  MANAGER: "Менеджер",
};

export default async function ForTeamPage() {
  const session = await auth();

  // «Ведёт на авторизацию и затем на раздел Для команды» — callbackUrl
  // возвращает сюда сразу после логина.
  if (!session?.user) {
    redirect(`/auth/signin?callbackUrl=${encodeURIComponent("/for-team")}`);
  }

  const { role, name } = session.user;
  const grantedSections = isTeamRole(role)
    ? await getUserAdminSections(session.user.id)
    : [];
  const groups = groupTeamServices(visibleTeamServices(role, grantedSections));

  return (
    <div className="bg-white min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-1 pt-14">
        <section className="max-w-[1200px] mx-auto px-6 py-12 md:py-16">
          <p className="text-[11px] tracking-[0.18em] uppercase text-[#86868b] font-[family-name:var(--font-inter)] font-medium">
            For team
          </p>
          <h1 className="mt-3 font-[family-name:var(--font-manrope)] font-semibold tracking-tight text-[#1d1d1f] text-[32px] md:text-[44px] leading-[1.1]">
            Для команды
          </h1>
          <p className="mt-4 max-w-[640px] text-[#1d1d1f]/60 text-[15px] md:text-base font-[family-name:var(--font-inter)] leading-relaxed">
            Общие сервисы бизнес-парка, которые работают прямо сейчас. Показаны
            только те разделы, к которым у вас есть доступ.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3 text-[13px] font-[family-name:var(--font-inter)]">
            <span className="inline-flex items-center gap-2 rounded-full bg-[#f5f5f7] px-4 py-2 text-[#1d1d1f]/70">
              {name || session.user.email || "Сотрудник"}
            </span>
            {roleLabel[role] && (
              <span className="inline-flex items-center gap-2 rounded-full bg-[#f5f5f7] px-4 py-2 text-[#1d1d1f]/70">
                {roleLabel[role]}
              </span>
            )}
          </div>

          {!isTeamRole(role) ? (
            <NoTeamAccess />
          ) : groups.length === 0 ? (
            <NoSectionsGranted />
          ) : (
            <div className="mt-12 flex flex-col gap-12">
              {groups.map(({ group, services }) => (
                <div key={group}>
                  <h2 className="font-[family-name:var(--font-manrope)] font-semibold tracking-tight text-[#1d1d1f] text-[19px]">
                    {group}
                  </h2>
                  <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {services.map((service) => (
                      <Link
                        key={service.section}
                        href={service.href}
                        className="group flex flex-col rounded-2xl border border-black/[0.06] bg-white p-5 transition-all hover:border-black/[0.14] hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)]"
                      >
                        <span aria-hidden className="text-[22px] leading-none">
                          {service.icon}
                        </span>
                        <span className="mt-3 font-[family-name:var(--font-manrope)] font-semibold tracking-tight text-[#1d1d1f] text-[15px]">
                          {service.label}
                        </span>
                        <span className="mt-1.5 text-[13px] text-[#1d1d1f]/55 font-[family-name:var(--font-inter)] leading-relaxed">
                          {service.description}
                        </span>
                        <span className="mt-4 text-[13px] text-[#0071e3] font-[family-name:var(--font-inter)] font-medium">
                          Открыть
                          <span
                            aria-hidden
                            className="inline-block transition-transform group-hover:translate-x-0.5"
                          >
                            {" →"}
                          </span>
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <Footer />
    </div>
  );
}

function NoTeamAccess() {
  return (
    <div className="mt-10 rounded-2xl border border-black/[0.06] bg-[#f5f5f7] p-6 max-w-[640px]">
      <p className="font-[family-name:var(--font-manrope)] font-semibold tracking-tight text-[#1d1d1f] text-[15px]">
        Этот раздел — для сотрудников парка
      </p>
      <p className="mt-2 text-[14px] text-[#1d1d1f]/60 font-[family-name:var(--font-inter)] leading-relaxed">
        Ваш аккаунт не отмечен как сотрудник. Свои брони, заказы и обращения
        можно посмотреть в личном кабинете. Если доступ к командным сервисам
        нужен по работе — попросите администратора выдать роль.
      </p>
      <Link
        href="/dashboard"
        className="mt-5 inline-flex items-center text-white text-[13px] px-5 py-2 rounded-full transition-all font-[family-name:var(--font-inter)] font-medium bg-[#0071e3] hover:bg-[#0077ED]"
      >
        В личный кабинет
      </Link>
    </div>
  );
}

function NoSectionsGranted() {
  return (
    <div className="mt-10 rounded-2xl border border-black/[0.06] bg-[#f5f5f7] p-6 max-w-[640px]">
      <p className="font-[family-name:var(--font-manrope)] font-semibold tracking-tight text-[#1d1d1f] text-[15px]">
        Разделы ещё не выданы
      </p>
      <p className="mt-2 text-[14px] text-[#1d1d1f]/60 font-[family-name:var(--font-inter)] leading-relaxed">
        Роль сотрудника у вас есть, но доступ ни к одному сервису пока не
        назначен. Попросите суперадмина выдать нужные разделы в «Пользователи».
      </p>
    </div>
  );
}
