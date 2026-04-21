-- CreateEnum
CREATE TYPE "EmailLogType" AS ENUM ('MANUAL', 'PAYMENT_PRE_REMINDER', 'PAYMENT_DUE_REMINDER', 'ESCALATION_INTERNAL');

-- CreateEnum
CREATE TYPE "EmailLogStatus" AS ENUM ('SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "ManagerTaskType" AS ENUM ('OVERDUE_PAYMENT');

-- CreateEnum
CREATE TYPE "ManagerTaskStatus" AS ENUM ('OPEN', 'RESOLVED', 'DEFERRED');

-- CreateTable
CREATE TABLE "RentalPayment" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "periodMonth" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "paidAt" TIMESTAMP(3),
    "markedPaidById" TEXT,
    "firstReminderSentAt" TIMESTAMP(3),
    "dueDateReminderSentAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "amountAdjustmentReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentalPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RentalPayment_contractId_periodYear_periodMonth_key"
    ON "RentalPayment"("contractId", "periodYear", "periodMonth");

-- CreateIndex
CREATE INDEX "RentalPayment_dueDate_paidAt_idx" ON "RentalPayment"("dueDate", "paidAt");

-- CreateIndex
CREATE INDEX "RentalPayment_contractId_paidAt_idx" ON "RentalPayment"("contractId", "paidAt");

-- AddForeignKey
ALTER TABLE "RentalPayment" ADD CONSTRAINT "RentalPayment_contractId_fkey"
    FOREIGN KEY ("contractId") REFERENCES "RentalContract"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "moduleSlug" TEXT NOT NULL DEFAULT 'rental',
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "bodyText" TEXT,
    "variables" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailTemplate_key_key" ON "EmailTemplate"("key");

-- CreateIndex
CREATE INDEX "EmailTemplate_moduleSlug_idx" ON "EmailTemplate"("moduleSlug");

-- CreateTable
CREATE TABLE "EmailLog" (
    "id" TEXT NOT NULL,
    "moduleSlug" TEXT NOT NULL DEFAULT 'rental',
    "type" "EmailLogType" NOT NULL,
    "templateKey" TEXT,
    "to" TEXT[],
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT,
    "tenantId" TEXT,
    "contractId" TEXT,
    "paymentId" TEXT,
    "periodYear" INTEGER,
    "periodMonth" INTEGER,
    "sentById" TEXT,
    "status" "EmailLogStatus" NOT NULL,
    "error" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailLog_tenantId_sentAt_idx" ON "EmailLog"("tenantId", "sentAt");

-- CreateIndex
CREATE INDEX "EmailLog_contractId_sentAt_idx" ON "EmailLog"("contractId", "sentAt");

-- CreateIndex
CREATE INDEX "EmailLog_status_sentAt_idx" ON "EmailLog"("status", "sentAt");

-- CreateIndex
CREATE INDEX "EmailLog_type_sentAt_idx" ON "EmailLog"("type", "sentAt");

-- CreateTable
CREATE TABLE "RentalNotificationSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "preReminderDays" INTEGER NOT NULL DEFAULT 5,
    "escalationDaysAfter" INTEGER NOT NULL DEFAULT 5,
    "autoSendEnabled" BOOLEAN NOT NULL DEFAULT false,
    "fromEmail" TEXT NOT NULL DEFAULT 'buh@delovoy-park.ru',
    "fromName" TEXT NOT NULL DEFAULT 'Бухгалтерия Делового Парка',
    "bankDetails" TEXT,
    "managerName" TEXT,
    "managerPhone" TEXT,
    "escalationTelegramEnabled" BOOLEAN NOT NULL DEFAULT true,
    "escalationTelegramChatId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "RentalNotificationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagerTask" (
    "id" TEXT NOT NULL,
    "moduleSlug" TEXT NOT NULL DEFAULT 'rental',
    "type" "ManagerTaskType" NOT NULL,
    "status" "ManagerTaskStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "contractId" TEXT,
    "tenantId" TEXT,
    "paymentId" TEXT,
    "periodYear" INTEGER,
    "periodMonth" INTEGER,
    "assignedToId" TEXT,
    "createdById" TEXT,
    "dueDate" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolution" TEXT,
    "resolutionNote" TEXT,
    "deferUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagerTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ManagerTask_type_contractId_periodYear_periodMonth_key"
    ON "ManagerTask"("type", "contractId", "periodYear", "periodMonth");

-- CreateIndex
CREATE INDEX "ManagerTask_status_assignedToId_idx" ON "ManagerTask"("status", "assignedToId");

-- CreateIndex
CREATE INDEX "ManagerTask_moduleSlug_status_idx" ON "ManagerTask"("moduleSlug", "status");

-- Seed: default singleton settings (autoSendEnabled=false until backfill)
INSERT INTO "RentalNotificationSettings" ("id", "updatedAt") VALUES ('singleton', NOW())
  ON CONFLICT ("id") DO NOTHING;

-- Seed: system email templates
INSERT INTO "EmailTemplate" ("id", "key", "name", "subject", "bodyHtml", "bodyText", "variables", "isActive", "isSystem", "updatedAt")
VALUES
  (
    'tpl_rental_pre',
    'rental.payment_reminder_pre',
    'Напоминание об оплате — за N дней',
    'Напоминание об оплате аренды — до {{dueDate}}',
    '<p>Здравствуйте, {{contactName}}!</p><p>Напоминаем, что по договору <b>№{{contractNumber}}</b> за помещение <b>№{{officeNumber}}</b> (корпус {{building}}, этаж {{floor}}) подходит срок оплаты аренды за {{periodMonth}} {{periodYear}}.</p><p>Сумма к оплате: <b>{{amount}}</b>.<br/>Срок оплаты: <b>{{dueDate}}</b>.</p><p>Реквизиты для оплаты:<br/><pre>{{bankDetails}}</pre></p><p>По всем вопросам: {{managerName}}, {{managerPhone}}.</p><p>С уважением,<br/>Бухгалтерия бизнес-парка «Деловой»<br/>{{parkAddress}}</p>',
    'Здравствуйте, {{contactName}}!\n\nПо договору №{{contractNumber}} (помещение №{{officeNumber}}) подходит срок оплаты аренды за {{periodMonth}} {{periodYear}}.\nСумма: {{amount}}. Срок: {{dueDate}}.\n\nРеквизиты:\n{{bankDetails}}\n\n{{managerName}}, {{managerPhone}}',
    '["contactName","contractNumber","officeNumber","building","floor","periodMonth","periodYear","amount","dueDate","bankDetails","managerName","managerPhone","parkAddress"]'::jsonb,
    true, true, NOW()
  ),
  (
    'tpl_rental_due',
    'rental.payment_reminder_due',
    'Напоминание об оплате — день платежа',
    'Сегодня срок оплаты аренды (договор №{{contractNumber}})',
    '<p>Здравствуйте, {{contactName}}!</p><p>Сегодня — <b>{{dueDate}}</b> — срок оплаты аренды по договору <b>№{{contractNumber}}</b> за помещение <b>№{{officeNumber}}</b>.</p><p>Сумма к оплате: <b>{{amount}}</b>.</p><p>Если оплата уже произведена — просим проигнорировать это письмо.</p><p>Реквизиты:<br/><pre>{{bankDetails}}</pre></p><p>По всем вопросам: {{managerName}}, {{managerPhone}}.</p><p>С уважением,<br/>Бухгалтерия бизнес-парка «Деловой»</p>',
    'Здравствуйте, {{contactName}}!\n\nСегодня ({{dueDate}}) срок оплаты аренды по договору №{{contractNumber}} (помещение №{{officeNumber}}).\nСумма: {{amount}}.\n\nРеквизиты:\n{{bankDetails}}\n\n{{managerName}}, {{managerPhone}}',
    '["contactName","contractNumber","officeNumber","building","floor","periodMonth","periodYear","amount","dueDate","bankDetails","managerName","managerPhone","parkAddress"]'::jsonb,
    true, true, NOW()
  ),
  (
    'tpl_rental_manual',
    'rental.manual',
    'Ручное письмо арендатору (заготовка)',
    'Сообщение от бизнес-парка «Деловой»',
    '<p>Здравствуйте, {{contactName}}!</p><p>&nbsp;</p><p>С уважением,<br/>{{managerName}}<br/>{{managerPhone}}</p>',
    'Здравствуйте, {{contactName}}!\n\n\n\n{{managerName}}, {{managerPhone}}',
    '["contactName","tenantName","contractNumber","officeNumber","managerName","managerPhone","parkAddress"]'::jsonb,
    true, true, NOW()
  )
ON CONFLICT ("key") DO NOTHING;
