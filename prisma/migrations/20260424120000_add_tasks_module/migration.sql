-- Tasks module: unified task tracker (INTERNAL) + tenant issue reports (ISSUE).
-- Core entity Task with TaskComment, TaskEvent (timeline), TaskCategory (routing)
-- and TaskSubscription. Designed to be forkable via nullable moduleContext.

-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('INTERNAL', 'ISSUE');

-- CreateEnum
CREATE TYPE "TaskSource" AS ENUM ('MANUAL', 'TELEGRAM', 'EMAIL', 'WEB', 'API');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "TaskEventKind" AS ENUM ('CREATED', 'STATUS_CHANGED', 'ASSIGNED', 'COMMENTED', 'REMINDED', 'RESOLVED', 'REOPENED', 'PRIORITY_CHANGED', 'DUE_DATE_CHANGED');

-- CreateEnum
CREATE TYPE "TaskCommentSource" AS ENUM ('WEB', 'TELEGRAM', 'EMAIL', 'API');

-- CreateTable
CREATE TABLE "TaskCategory" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "defaultAssigneeUserId" TEXT,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaskCategory_slug_key" ON "TaskCategory"("slug");

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "type" "TaskType" NOT NULL,
    "source" "TaskSource" NOT NULL,
    "moduleContext" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "categoryId" TEXT,
    "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reporterUserId" TEXT,
    "assigneeUserId" TEXT,
    "externalTenantId" TEXT,
    "externalOfficeId" TEXT,
    "externalContact" JSONB,
    "dueDate" TIMESTAMP(3),
    "remindAt" TIMESTAMP(3),
    "reminderSentAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "emailThreadId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Task_publicId_key" ON "Task"("publicId");
CREATE INDEX "Task_type_status_idx" ON "Task"("type", "status");
CREATE INDEX "Task_assigneeUserId_status_idx" ON "Task"("assigneeUserId", "status");
CREATE INDEX "Task_reporterUserId_idx" ON "Task"("reporterUserId");
CREATE INDEX "Task_categoryId_idx" ON "Task"("categoryId");
CREATE INDEX "Task_remindAt_reminderSentAt_idx" ON "Task"("remindAt", "reminderSentAt");
CREATE INDEX "Task_publicId_idx" ON "Task"("publicId");
CREATE INDEX "Task_moduleContext_idx" ON "Task"("moduleContext");

-- CreateTable
CREATE TABLE "TaskComment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorUserId" TEXT,
    "authorExternal" JSONB,
    "body" TEXT NOT NULL,
    "source" "TaskCommentSource" NOT NULL DEFAULT 'WEB',
    "emailMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaskComment_emailMessageId_key" ON "TaskComment"("emailMessageId");
CREATE INDEX "TaskComment_taskId_createdAt_idx" ON "TaskComment"("taskId", "createdAt");

-- CreateTable
CREATE TABLE "TaskEvent" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "kind" "TaskEventKind" NOT NULL,
    "actorUserId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskEvent_taskId_createdAt_idx" ON "TaskEvent"("taskId", "createdAt");

-- CreateTable
CREATE TABLE "TaskSubscription" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channels" TEXT[] DEFAULT ARRAY['TELEGRAM', 'EMAIL']::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaskSubscription_taskId_userId_key" ON "TaskSubscription"("taskId", "userId");

-- AddForeignKey
ALTER TABLE "TaskCategory" ADD CONSTRAINT "TaskCategory_defaultAssigneeUserId_fkey" FOREIGN KEY ("defaultAssigneeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Task" ADD CONSTRAINT "Task_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TaskCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_externalTenantId_fkey" FOREIGN KEY ("externalTenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_externalOfficeId_fkey" FOREIGN KEY ("externalOfficeId") REFERENCES "Office"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TaskSubscription" ADD CONSTRAINT "TaskSubscription_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskSubscription" ADD CONSTRAINT "TaskSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
