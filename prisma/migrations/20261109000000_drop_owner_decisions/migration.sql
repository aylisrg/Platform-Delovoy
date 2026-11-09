-- Контур owner-decisions удалён вместе с автоочередью (ADR 2026-11-09-process-minimum).
-- Таблица хранила только служебные запросы автоматики, бизнес-данных в ней нет.

-- DropTable
DROP TABLE IF EXISTS "OwnerDecision";

-- DropEnum
DROP TYPE IF EXISTS "OwnerDecisionStatus";
