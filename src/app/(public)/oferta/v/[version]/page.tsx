import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DOCUMENT_KEYS, getVersionBySlug } from "@/modules/booking/offer";
import { LegalPage, printColophon } from "@/components/legal/legal-page";

export const dynamic = "force-dynamic";

/**
 * Архивная редакция.
 *
 * `noindex` и canonical на `/oferta`: в поиске должна быть одна действующая
 * редакция, но по прямой ссылке (из письма-подтверждения) архивная обязана
 * открываться — клиент заключил договор именно на этих условиях.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ version: string }>;
}): Promise<Metadata> {
  const { version } = await params;
  const revision = await getVersionBySlug(DOCUMENT_KEYS.gazebosOffer, version);
  return {
    title: revision
      ? `Публичная оферта — Барбекю Парк, редакция № ${revision.number}`
      : "Редакция оферты не найдена",
    alternates: { canonical: "/oferta" },
    robots: { index: false, follow: true },
  };
}

export default async function OfertaVersionPage({
  params,
}: {
  params: Promise<{ version: string }>;
}) {
  const { version } = await params;
  const revision = await getVersionBySlug(DOCUMENT_KEYS.gazebosOffer, version);
  if (!revision) notFound();

  const current = revision.isCurrent === true;

  return (
    <LegalPage
      body={revision.body}
      badge={{
        number: revision.number,
        effectiveAt: revision.effectiveAt,
        archiveHref: "/oferta/archive",
        ...(current ? {} : { supersededHref: "/oferta" }),
      }}
      colophon={printColophon("Публичная оферта", revision.number, revision.effectiveAt)}
    />
  );
}
