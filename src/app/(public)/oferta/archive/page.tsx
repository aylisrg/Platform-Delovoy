import type { Metadata } from "next";
import Link from "next/link";
import { DOCUMENT_KEYS, listVersions } from "@/modules/booking/offer";
import { Navbar } from "@landing/components/navbar";
import { Footer } from "@landing/components/footer";

export const dynamic = "force-dynamic";

/**
 * Архив редакций оферты (п. 13.4 оферты: «архив предыдущих редакций хранится
 * на Сайте и доступен Заказчику»).
 *
 * `noindex`: в поиске должна быть одна действующая редакция.
 */
export const metadata: Metadata = {
  title: "Редакции публичной оферты — Барбекю Парк",
  alternates: { canonical: "/oferta" },
  robots: { index: false, follow: true },
};

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export default async function OfertaArchivePage() {
  const versions = await listVersions(DOCUMENT_KEYS.gazebosOffer);

  return (
    <div className="legal-page min-h-screen bg-[var(--background)]">
      <div className="legal-chrome">
        <Navbar />
      </div>

      <main className="pt-20">
        <div className="mx-auto max-w-[720px] px-6 py-12 lg:py-16">
          <h1 className="font-[family-name:var(--font-manrope)] text-[2rem] font-semibold leading-tight tracking-tight text-[var(--foreground)]">
            Редакции публичной оферты
          </h1>
          <p className="mt-3 text-[17px] leading-relaxed text-[#5a5a5f]">
            К уже заключённым договорам применяется редакция, действовавшая на момент
            оплаты бронирования. Её номер указан в подтверждении бронирования.
          </p>

          <ul className="mt-8 divide-y divide-[var(--border)] border-y border-[var(--border)]">
            {versions.map((version) => (
              <li key={version.id} className="py-4">
                <Link
                  href={version.isCurrent ? "/oferta" : `/oferta/v/${version.slug}`}
                  className="group flex flex-wrap items-baseline gap-x-3 gap-y-1"
                >
                  <span className="text-[17px] font-medium text-[var(--accent)] underline underline-offset-2">
                    Редакция № {version.number}
                  </span>
                  {version.isCurrent && (
                    <span className="rounded-full bg-[var(--surface)] px-2.5 py-0.5 text-xs font-medium text-[var(--foreground)]">
                      действующая
                    </span>
                  )}
                  <span className="text-[15px] text-[#5a5a5f]">
                    действует с {formatDate(version.effectiveAt)} · размещена{" "}
                    {formatDate(version.publishedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          {versions.length === 0 && (
            <p className="mt-8 text-[17px] text-[#5a5a5f]">Редакции пока не опубликованы.</p>
          )}
        </div>
      </main>

      <div className="legal-chrome">
        <Footer />
      </div>
    </div>
  );
}
