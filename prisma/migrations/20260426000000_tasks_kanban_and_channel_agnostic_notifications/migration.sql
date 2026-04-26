Loaded Prisma config from prisma.config.ts.

-- CreateEnum
CREATE TYPE "TaskSource" AS ENUM ('MANUAL', 'TELEGRAM', 'EMAIL', 'WEB', 'API');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "TaskAssigneeRole" AS ENUM ('RESPONSIBLE', 'COLLABORATOR', 'WATCHER');

-- CreateEnum
CREATE TYPE "TaskEventKind" AS ENUM ('CREATED', 'STATUS_CHANGED', 'COLUMN_CHANGED', 'COLUMN_REORDERED', 'ASSIGNEE_ADDED', 'ASSIGNEE_REMOVED', 'ASSIGNEE_ROLE_CHANGED', 'CATEGORY_CHANGED', 'PRIORITY_CHANGED', 'DUE_CHANGED', 'TITLE_CHANGED', 'DESCRIPTION_CHANGED', 'LABEL_ADDED', 'LABEL_REMOVED', 'COMMENT_ADDED', 'REPORTER_LINKED', 'ATTACHMENT_ADDED');

-- CreateEnum
CREATE TYPE "TaskCommentSource" AS ENUM ('MANUAL', 'EMAIL', 'TELEGRAM', 'PUBLIC_TRACK', 'SYSTEM');

-- CreateEnum
CREATE TYPE "NotificationChannelKind" AS ENUM ('TELEGRAM', 'EMAIL', 'WHATSAPP', 'MAX', 'IMESSAGE', 'SMS', 'PUSH', 'VK');

-- CreateEnum
CREATE TYPE "OutgoingNotificationStatus" AS ENUM ('PENDING', 'DEFERRED', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "NotificationSubscriptionScope" AS ENUM ('TASK', 'BOARD', 'CATEGORY');

-- CreateTable
CREATE TABLE "TaskBoard" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskBoard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskColumn" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#9CA3AF',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isTerminal" BOOLEAN NOT NULL DEFAULT false,
    "wipLimit" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskColumn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskCategory" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#9CA3AF',
    "defaultBoardId" TEXT,
    "defaultResponsibleUserId" TEXT,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "priorityHint" "TaskPriority" NOT NULL DEFAULT 'NONE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "columnId" TEXT NOT NULL,
    "categoryId" TEXT,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "priority" "TaskPriority" NOT NULL DEFAULT 'NONE',
    "dueAt" TIMESTAMP(3),
    "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" "TaskSource" NOT NULL,
    "reporterUserId" TEXT,
    "externalContact" JSONB,
    "officeId" TEXT,
    "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "closedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAssignee" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "TaskAssigneeRole" NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedById" TEXT,

    CONSTRAINT "TaskAssignee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskComment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorUserId" TEXT,
    "externalAuthor" JSONB,
    "body" TEXT NOT NULL,
    "visibleToReporter" BOOLEAN NOT NULL DEFAULT false,
    "attachments" JSONB,
    "source" "TaskCommentSource" NOT NULL DEFAULT 'MANUAL',
    "emailMessageId" TEXT,
    "inReplyToCommentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskEvent" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "kind" "TaskEventKind" NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" "NotificationSubscriptionScope" NOT NULL,
    "taskId" TEXT,
    "boardId" TEXT,
    "categoryId" TEXT,
    "eventKinds" "TaskEventKind"[] DEFAULT ARRAY[]::"TaskEventKind"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedTaskView" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "boardId" TEXT,
    "name" VARCHAR(80) NOT NULL,
    "filters" JSONB NOT NULL,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedTaskView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserNotificationChannel" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "NotificationChannelKind" NOT NULL,
    "address" TEXT NOT NULL,
    "label" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "verifiedAt" TIMESTAMP(3),
    "verificationCodeHash" TEXT,
    "verificationExpiresAt" TIMESTAMP(3),
    "verificationAttempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserNotificationChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationEventPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "channelKinds" "NotificationChannelKind"[] DEFAULT ARRAY[]::"NotificationChannelKind"[],
    "quietHoursFrom" TEXT,
    "quietHoursTo" TEXT,
    "quietWeekdaysOnly" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Moscow',
    "dndUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationEventPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationGlobalPreference" (
    "userId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Moscow',
    "quietHoursFrom" TEXT,
    "quietHoursTo" TEXT,
    "dndUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationGlobalPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "OutgoingNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "channelId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutgoingNotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "scheduledFor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "dedupKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutgoingNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaskBoard_slug_key" ON "TaskBoard"("slug");

-- CreateIndex
CREATE INDEX "TaskBoard_isArchived_sortOrder_idx" ON "TaskBoard"("isArchived", "sortOrder");

-- CreateIndex
CREATE INDEX "TaskColumn_boardId_idx" ON "TaskColumn"("boardId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskColumn_boardId_sortOrder_key" ON "TaskColumn"("boardId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "TaskCategory_slug_key" ON "TaskCategory"("slug");

-- CreateIndex
CREATE INDEX "TaskCategory_isArchived_idx" ON "TaskCategory"("isArchived");

-- CreateIndex
CREATE UNIQUE INDEX "Task_publicId_key" ON "Task"("publicId");

-- CreateIndex
CREATE INDEX "Task_boardId_columnId_sortOrder_idx" ON "Task"("boardId", "columnId", "sortOrder");

-- CreateIndex
CREATE INDEX "Task_categoryId_idx" ON "Task"("categoryId");

-- CreateIndex
CREATE INDEX "Task_reporterUserId_idx" ON "Task"("reporterUserId");

-- CreateIndex
CREATE INDEX "Task_officeId_idx" ON "Task"("officeId");

-- CreateIndex
CREATE INDEX "Task_source_idx" ON "Task"("source");

-- CreateIndex
CREATE INDEX "Task_dueAt_idx" ON "Task"("dueAt");

-- CreateIndex
CREATE INDEX "Task_closedAt_idx" ON "Task"("closedAt");

-- CreateIndex
CREATE INDEX "Task_deletedAt_idx" ON "Task"("deletedAt");

-- CreateIndex
CREATE INDEX "TaskAssignee_userId_role_idx" ON "TaskAssignee"("userId", "role");

-- CreateIndex
CREATE INDEX "TaskAssignee_taskId_idx" ON "TaskAssignee"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskAssignee_taskId_userId_key" ON "TaskAssignee"("taskId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskComment_emailMessageId_key" ON "TaskComment"("emailMessageId");

-- CreateIndex
CREATE INDEX "TaskComment_taskId_createdAt_idx" ON "TaskComment"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskComment_authorUserId_idx" ON "TaskComment"("authorUserId");

-- CreateIndex
CREATE INDEX "TaskEvent_taskId_createdAt_idx" ON "TaskEvent"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskEvent_actorUserId_idx" ON "TaskEvent"("actorUserId");

-- CreateIndex
CREATE INDEX "TaskEvent_kind_createdAt_idx" ON "TaskEvent"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "TaskSubscription_userId_idx" ON "TaskSubscription"("userId");

-- CreateIndex
CREATE INDEX "TaskSubscription_scope_taskId_idx" ON "TaskSubscription"("scope", "taskId");

-- CreateIndex
CREATE INDEX "TaskSubscription_scope_boardId_idx" ON "TaskSubscription"("scope", "boardId");

-- CreateIndex
CREATE INDEX "TaskSubscription_scope_categoryId_idx" ON "TaskSubscription"("scope", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskSubscription_userId_scope_taskId_boardId_categoryId_key" ON "TaskSubscription"("userId", "scope", "taskId", "boardId", "categoryId");

-- CreateIndex
CREATE INDEX "SavedTaskView_userId_boardId_idx" ON "SavedTaskView"("userId", "boardId");

-- CreateIndex
CREATE INDEX "UserNotificationChannel_userId_isActive_priority_idx" ON "UserNotificationChannel"("userId", "isActive", "priority");

-- CreateIndex
CREATE INDEX "UserNotificationChannel_kind_idx" ON "UserNotificationChannel"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "UserNotificationChannel_userId_kind_address_key" ON "UserNotificationChannel"("userId", "kind", "address");

-- CreateIndex
CREATE INDEX "NotificationEventPreference_userId_idx" ON "NotificationEventPreference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationEventPreference_userId_eventType_key" ON "NotificationEventPreference"("userId", "eventType");

-- CreateIndex
CREATE INDEX "OutgoingNotification_status_scheduledFor_idx" ON "OutgoingNotification"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "OutgoingNotification_dedupKey_createdAt_idx" ON "OutgoingNotification"("dedupKey", "createdAt");

-- CreateIndex
CREATE INDEX "OutgoingNotification_userId_createdAt_idx" ON "OutgoingNotification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "OutgoingNotification_entityType_entityId_idx" ON "OutgoingNotification"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "TaskColumn" ADD CONSTRAINT "TaskColumn_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "TaskBoard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "TaskBoard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "TaskColumn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TaskCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskSubscription" ADD CONSTRAINT "TaskSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskSubscription" ADD CONSTRAINT "TaskSubscription_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedTaskView" ADD CONSTRAINT "SavedTaskView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNotificationChannel" ADD CONSTRAINT "UserNotificationChannel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationEventPreference" ADD CONSTRAINT "NotificationEventPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationGlobalPreference" ADD CONSTRAINT "NotificationGlobalPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutgoingNotification" ADD CONSTRAINT "OutgoingNotification_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "UserNotificationChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

