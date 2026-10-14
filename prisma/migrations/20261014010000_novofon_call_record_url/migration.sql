-- #1066 PR2: ссылка на запись из вебхука «Записанный разговор». Только новая nullable-колонка.

-- AlterTable
ALTER TABLE "NovofonCall" ADD COLUMN "recordUrl" TEXT;
