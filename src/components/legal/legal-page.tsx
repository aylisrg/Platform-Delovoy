import { Navbar } from "@landing/components/navbar";
import { Footer } from "@landing/components/footer";
import { parseLegalDocument } from "@/lib/legal/parse-document";
import { LegalDocumentView, type RevisionBadge } from "./legal-document";

/**
 * Каркас страницы юридического документа: шапка сайта, документ, футер.
 *
 * Шапка и футер обёрнуты в `.legal-chrome` — в печатной версии CSS их
 * скрывает, чтобы по Ctrl+P получался нормальный PDF (ТЗ §4.2).
 */
export function LegalPage({
  body,
  badge,
  colophon,
}: {
  body: string;
  badge: RevisionBadge;
  colophon: string;
}) {
  const doc = parseLegalDocument(body);

  return (
    <div className="legal-page min-h-screen bg-[var(--background)]">
      <div className="legal-chrome">
        <Navbar />
      </div>

      <main className="pt-20">
        <LegalDocumentView doc={doc} badge={badge} colophon={colophon} />
      </main>

      <div className="legal-chrome">
        <Footer />
      </div>
    </div>
  );
}

/** Строка колонтитула печатной версии: номер редакции и дата вступления. */
export function printColophon(title: string, number: number, effectiveAt: Date): string {
  const date = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(effectiveAt);
  return `${title} · Редакция № ${number} · действует с ${date} · ИП Павленко Л. П., ОГРНИП 305770002665641`;
}
