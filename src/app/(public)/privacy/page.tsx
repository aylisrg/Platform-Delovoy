import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DOCUMENT_KEYS, getCurrentVersion } from "@/modules/booking/offer";
import { LegalPage, printColophon } from "@/components/legal/legal-page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Политика обработки персональных данных",
  description:
    "Политика в отношении обработки персональных данных ИП Павленко Л. П.: состав данных, цели и правовые основания обработки, сроки хранения, права субъекта.",
  alternates: { canonical: "/privacy" },
  robots: { index: true, follow: true },
};

export default async function PrivacyPage() {
  const version = await getCurrentVersion(DOCUMENT_KEYS.privacyPolicy);
  if (!version) notFound();

  return (
    <LegalPage
      body={version.body}
      badge={{
        number: version.number,
        effectiveAt: version.effectiveAt,
        archiveHref: null,
      }}
      colophon={printColophon(
        "Политика обработки персональных данных",
        version.number,
        version.effectiveAt
      )}
    />
  );
}
