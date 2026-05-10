-- CreateTable: WebPushSubscription (sidecar 1:1 для UserNotificationChannel(kind=PUSH))
CREATE TABLE "WebPushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userNotificationChannelId" TEXT,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastFailureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebPushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebPushSubscription_userNotificationChannelId_key" ON "WebPushSubscription"("userNotificationChannelId");

-- CreateIndex
CREATE UNIQUE INDEX "WebPushSubscription_endpoint_key" ON "WebPushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "WebPushSubscription_userId_isActive_idx" ON "WebPushSubscription"("userId", "isActive");

-- AddForeignKey
ALTER TABLE "WebPushSubscription" ADD CONSTRAINT "WebPushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebPushSubscription" ADD CONSTRAINT "WebPushSubscription_userNotificationChannelId_fkey" FOREIGN KEY ("userNotificationChannelId") REFERENCES "UserNotificationChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
