import Link from "next/link";
import type { LegalBlock, LegalDocument } from "@/lib/legal/types";
import { CopyAnchorButton } from "./copy-anchor-button";
import { LegalToc, type TocEntry } from "./legal-toc";

/**
 * Рендер опубликованной редакции юридического документа.
 *
 * Чего здесь намеренно НЕТ (ТЗ §4.3): аккордеонов и «показать полностью» —
 * свёрнутый текст это аргумент в суде, что пользователь не имел возможности
 * ознакомиться; модалок вместо страницы; любых CTA — страница не продаёт.
 */

export type RevisionBadge = {
  number: number;
  effectiveAt: Date;
  /** Ссылка на архив редакций; null — если архива для документа нет. */
  archiveHref: string | null;
  /** Пометка для архивной редакции: «эта редакция больше не действует». */
  supersededHref?: string;
};

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function tableOfContents(doc: LegalDocument): TocEntry[] {
  return doc.sections.map((section) => ({
    id: section.id,
    label: section.number ? `${section.number}. ${section.title}` : section.title,
    level: section.level,
  }));
}

function Block({ block }: { block: LegalBlock }) {
  switch (block.kind) {
    case "clause":
      return (
        <div className="legal-clause mt-4" id={block.id}>
          <span className="legal-clause__num">{block.number}.</span>
          <div
            className="legal-clause__body"
            dangerouslySetInnerHTML={{ __html: block.html }}
          />
          <CopyAnchorButton anchor={block.id} label={block.number} />
        </div>
      );
    case "subheading":
      return (
        <h3 className="mt-8 mb-1" id={block.id}>
          {block.number ? `${block.number}. ` : ""}
          {block.label}
        </h3>
      );
    case "quote":
      return (
        <blockquote
          className="mt-4 border-l-2 border-[var(--border)] bg-[var(--surface)] px-4 py-3 rounded-r-lg"
          dangerouslySetInnerHTML={{ __html: block.html }}
        />
      );
    case "table":
      return (
        <div className="mt-4 overflow-x-auto">
          <table>
            <thead>
              <tr>
                {block.head.map((cell, i) => (
                  <th key={i} dangerouslySetInnerHTML={{ __html: cell }} />
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} dangerouslySetInnerHTML={{ __html: cell }} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "paragraph":
      return <p className="mt-4" dangerouslySetInnerHTML={{ __html: block.html }} />;
  }
}

export function LegalDocumentView({
  doc,
  badge,
  colophon,
}: {
  doc: LegalDocument;
  badge: RevisionBadge;
  /** Строка колонтитула печатной версии. */
  colophon: string;
}) {
  const toc = tableOfContents(doc);

  return (
    <div className="mx-auto flex max-w-[1200px] gap-12 px-6 py-12 lg:py-16">
      <LegalToc entries={toc} />

      <article className="legal-doc min-w-0 flex-1">
        <div className="legal-print-colophon">{colophon}</div>

        <h1>{doc.title}</h1>
        {doc.subtitle && (
          <p className="mt-2 text-[1.0625rem] leading-snug text-[#5a5a5f]">{doc.subtitle}</p>
        )}

        {/* Плашка редакции: это дата, от которой считается применимость
            условий — спокойная, но не мелкая. */}
        <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[15px] leading-relaxed">
          <strong>Редакция № {badge.number}</strong>
          <span className="mx-2 text-[#86868b]">·</span>
          действует с {formatDate(badge.effectiveAt)}
          {badge.archiveHref && (
            <>
              <span className="mx-2 text-[#86868b]">·</span>
              <Link href={badge.archiveHref}>Предыдущие редакции</Link>
            </>
          )}
          {badge.supersededHref && (
            <p className="mt-2 text-[15px]">
              Это архивная редакция.{" "}
              <Link href={badge.supersededHref}>Открыть действующую редакцию</Link>
            </p>
          )}
        </div>

        {doc.preamble.map((block, i) => (
          <Block key={i} block={block} />
        ))}

        {doc.sections.map((section) => (
          <section key={section.id} className="mt-10">
            <h2 id={section.id}>
              {section.number ? `${section.number}. ` : ""}
              {section.title}
            </h2>
            {section.blocks.map((block, i) => (
              <Block key={i} block={block} />
            ))}
          </section>
        ))}
      </article>
    </div>
  );
}
