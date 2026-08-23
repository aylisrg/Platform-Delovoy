-- Публикация оферты и фиксация акцепта (ТЗ «Публикация оферты и процесс
-- акцепта при онлайн-бронировании», §4 и §6).
--
-- Миграция строго аддитивная: новая таблица + nullable-колонки на Booking.
-- Существующие брони (созданные до публикации оферты) и админ-брони,
-- где акцепт за клиента не проставляется, остаются валидными без backfill.

-- === Редакции юридических документов ===
CREATE TABLE "OfferVersion" (
    "id" TEXT NOT NULL,
    "documentKey" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferVersion_pkey" PRIMARY KEY ("id")
);

-- Номер и slug уникальны в пределах документа: у оферты Плей Парка будет
-- своя «редакция № 1».
CREATE UNIQUE INDEX "OfferVersion_documentKey_number_key" ON "OfferVersion"("documentKey", "number");
CREATE UNIQUE INDEX "OfferVersion_documentKey_slug_key" ON "OfferVersion"("documentKey", "slug");
CREATE INDEX "OfferVersion_documentKey_isCurrent_idx" ON "OfferVersion"("documentKey", "isCurrent");

-- === Доказательственный слой акцепта на брони ===
ALTER TABLE "Booking"
    ADD COLUMN "offerVersionId" TEXT,
    ADD COLUMN "offerContentHash" TEXT,
    ADD COLUMN "acceptedOfferAt" TIMESTAMP(3),
    ADD COLUMN "acceptedMarketing" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "acceptedIp" TEXT,
    ADD COLUMN "acceptedUserAgent" TEXT,
    ADD COLUMN "manageTokenHash" TEXT;

CREATE UNIQUE INDEX "Booking_manageTokenHash_key" ON "Booking"("manageTokenHash");
CREATE INDEX "Booking_offerVersionId_idx" ON "Booking"("offerVersionId");

ALTER TABLE "Booking"
    ADD CONSTRAINT "Booking_offerVersionId_fkey"
    FOREIGN KEY ("offerVersionId") REFERENCES "OfferVersion"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
