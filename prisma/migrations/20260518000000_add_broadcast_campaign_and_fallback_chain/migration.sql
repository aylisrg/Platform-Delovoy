-- Migration: Add BroadcastCampaign table and channel fallback fields to OutgoingNotification
-- Enables cohort broadcasting with per-user channel fallback chain.

-- 1. Add fallback chain fields to OutgoingNotification
ALTER TABLE "OutgoingNotification"
  ADD COLUMN IF NOT EXISTS "triedChannelIds" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "fallbackOfId" TEXT;

-- 2. Create BroadcastCampaign table
CREATE TABLE IF NOT EXISTS "BroadcastCampaign" (
  "id"         TEXT NOT NULL,
  "segmentKey" TEXT NOT NULL,
  "eventType"  TEXT NOT NULL,
  "payload"    JSONB NOT NULL,
  "createdBy"  TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "total"      INTEGER NOT NULL DEFAULT 0,
  "sent"       INTEGER NOT NULL DEFAULT 0,
  "failed"     INTEGER NOT NULL DEFAULT 0,
  "status"     TEXT NOT NULL DEFAULT 'running',

  CONSTRAINT "BroadcastCampaign_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BroadcastCampaign_createdAt_idx" ON "BroadcastCampaign"("createdAt");
CREATE INDEX IF NOT EXISTS "BroadcastCampaign_status_idx"    ON "BroadcastCampaign"("status");
