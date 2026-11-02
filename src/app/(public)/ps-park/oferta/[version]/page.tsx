import { notFound } from "next/navigation";
import { DOCUMENT_KEYS, getVersionBySlug } from "@/modules/booking/offer";
import { LegalPage, printColophon } from "@/components/legal/legal-page";

export const dynamic = "force-dynamic";

/** Только опубликованный владельцем документ; текста-заглушки здесь нет. */
export default async function PSParkOfferPage({ params }: { params: Promise<{ version: string }> }) {
  const { version: slug } = await params;
  const version = await getVersionBySlug(DOCUMENT_KEYS.psParkOffer, slug);
  if (!version) notFound();
  return <LegalPage body={version.body} badge={{ number: version.number, effectiveAt: version.effectiveAt, archiveHref: null }} colophon={printColophon("Оферта Плей Парка", version.number, version.effectiveAt)} />;
}
