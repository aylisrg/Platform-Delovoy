import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DOCUMENT_KEYS, getCurrentVersion } from "@/modules/booking/offer";
import { LegalPage, printColophon } from "@/components/legal/legal-page";

/** Действующая редакция публикуется из БД — правки текста здесь невозможны. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Публичная оферта — Барбекю Парк",
  description:
    "Публичная оферта о заключении договора возмездного оказания услуг по предоставлению беседки (зоны отдыха) «Барбекю Парк». Условия бронирования, оплаты, отмены и переноса.",
  alternates: { canonical: "/oferta" },
  robots: { index: true, follow: true },
};

export default async function OfertaPage() {
  const version = await getCurrentVersion(DOCUMENT_KEYS.gazebosOffer);
  if (!version) notFound();

  return (
    <LegalPage
      body={version.body}
      badge={{
        number: version.number,
        effectiveAt: version.effectiveAt,
        archiveHref: "/oferta/archive",
      }}
      colophon={printColophon("Публичная оферта", version.number, version.effectiveAt)}
    />
  );
}
