-- Migration: add birthday and gender fields to User
-- These fields are populated from Yandex OAuth (and can be set manually in profile)

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "birthday" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "gender"   TEXT;
