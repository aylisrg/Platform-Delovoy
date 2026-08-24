-- Передача наличной выручки смены в бухгалтерию (инкассация).
--
-- Аддитивная миграция: все колонки nullable, существующие смены остаются
-- валидными и просто считаются «не переданными».
ALTER TABLE "ShiftHandover"
  ADD COLUMN "handedOverAt"     TIMESTAMP(3),
  ADD COLUMN "handedOverAmount" DECIMAL(65,30),
  ADD COLUMN "handedOverById"   TEXT,
  ADD COLUMN "handedOverByName" TEXT,
  ADD COLUMN "handedOverTo"     TEXT,
  ADD COLUMN "handoverNote"     TEXT,
  ADD COLUMN "handoverCorrectedAt" TIMESTAMP(3);
