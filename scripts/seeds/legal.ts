/**
 * Legal documents seed — публикует редакции оферты и политики обработки ПД.
 *
 * Идемпотентность с оговоркой: обычный сидер при повторном запуске обновляет
 * данные, здесь — наоборот. Опубликованная редакция НЕИЗМЕНЯЕМА (ТЗ §4.1,
 * требование #6): содержание должно быть восстановимо ровно в том виде, в
 * каком его видел конкретный клиент год назад. Поэтому:
 *
 *   - новой редакции нет в БД → создаём;
 *   - редакция есть и текст совпадает → ничего не делаем;
 *   - редакция есть, а текст файла разошёлся → падаем с ошибкой.
 *
 * Последнее — не перестраховка: тихая перезапись `body` сломала бы хеши,
 * скопированные в уже заключённые договоры, и обнулила доказательственную
 * ценность всей конструкции. Правка текста = новый файл `vN.md` + новая
 * запись здесь.
 *
 * Один и только один `isCurrent` на документ.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { hashDocumentBody } from "../../src/modules/booking/offer";

type DocumentRevision = {
  documentKey: string;
  number: number;
  slug: string;
  title: string;
  /** Путь относительно корня репозитория. */
  file: string;
  publishedAt: string;
  effectiveAt: string;
  isCurrent: boolean;
};

/**
 * Реестр опубликованных редакций.
 *
 * Даты — из шапки самих документов, а не из момента деплоя: оферта вступает в
 * силу с даты, которую видит клиент на странице.
 */
const REVISIONS: DocumentRevision[] = [
  {
    documentKey: "gazebos-offer",
    number: 1,
    slug: "v1",
    title: "Публичная оферта — Барбекю Парк",
    file: "content/legal/gazebos-offer/v1.md",
    publishedAt: "2026-08-21T00:00:00.000Z",
    effectiveAt: "2026-08-22T00:00:00.000Z",
    isCurrent: true,
  },
  {
    documentKey: "privacy-policy",
    number: 1,
    slug: "v1",
    title: "Политика в отношении обработки персональных данных",
    file: "content/legal/privacy-policy/v1.md",
    publishedAt: "2026-08-21T00:00:00.000Z",
    effectiveAt: "2026-08-22T00:00:00.000Z",
    isCurrent: true,
  },
];

export async function seedLegalDocuments(prisma: PrismaClient): Promise<void> {
  for (const revision of REVISIONS) {
    const body = readFileSync(join(process.cwd(), revision.file), "utf-8");
    const contentHash = hashDocumentBody(body);

    const existing = await prisma.offerVersion.findFirst({
      where: { documentKey: revision.documentKey, slug: revision.slug },
    });

    if (existing && existing.contentHash !== contentHash) {
      throw new Error(
        `Текст редакции ${revision.documentKey}/${revision.slug} разошёлся с опубликованным. ` +
          `Опубликованная редакция неизменяема — заведите новую (vN+1), а не правьте эту. ` +
          `В БД: ${existing.contentHash}, в файле ${revision.file}: ${contentHash}`
      );
    }

    if (!existing) {
      await prisma.offerVersion.create({
        data: {
          documentKey: revision.documentKey,
          number: revision.number,
          slug: revision.slug,
          title: revision.title,
          body,
          contentHash,
          publishedAt: new Date(revision.publishedAt),
          effectiveAt: new Date(revision.effectiveAt),
          isCurrent: false, // выставим ниже, одной операцией на документ
        },
      });
      console.log(`  ✓ опубликована редакция ${revision.documentKey}/${revision.slug}`);
    } else {
      // Заголовок и даты — описательные поля, их править можно.
      await prisma.offerVersion.update({
        where: { id: existing.id },
        data: {
          title: revision.title,
          publishedAt: new Date(revision.publishedAt),
          effectiveAt: new Date(revision.effectiveAt),
        },
      });
    }
  }

  // Ровно один isCurrent на документ. Считаем от реестра, а не от того, что
  // лежит в БД: если действующую редакцию переключили руками, сидер вернёт
  // состояние, описанное в коде.
  const documentKeys = [...new Set(REVISIONS.map((r) => r.documentKey))];
  for (const documentKey of documentKeys) {
    const current = REVISIONS.find((r) => r.documentKey === documentKey && r.isCurrent);
    if (!current) continue;
    await prisma.offerVersion.updateMany({
      where: { documentKey, slug: { not: current.slug } },
      data: { isCurrent: false },
    });
    await prisma.offerVersion.updateMany({
      where: { documentKey, slug: current.slug },
      data: { isCurrent: true },
    });
  }

  console.log("✅ Legal documents seeded");
}
