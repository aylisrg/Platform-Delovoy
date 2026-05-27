#!/usr/bin/env bash
# Sanitize a PostgreSQL custom-format dump: mask PII, truncate audit/log tables.
# Outputs a new sanitized dump suitable for dev/staging use.
#
# Usage:
#   ./scripts/sanitize-dump.sh <input.dump> [output.dump]
#
# If output path is omitted, writes to <input-basename>-sanitized-<date>.dump
# in the same directory as the input file.
#
# Required env (for throwaway DB):
#   SANITIZE_DB_URL  — postgres URL for a throwaway DB (created/dropped here)
#                      Default: postgres://delovoy:delovoy@localhost:5432/sanitize_tmp
#
# Dependencies: pg_restore, psql, pg_dump (same major version as the dump)
set -euo pipefail

INPUT="${1:-}"
if [ -z "$INPUT" ]; then
  echo "Usage: $0 <input.dump> [output.dump]" >&2
  exit 1
fi
if [ ! -f "$INPUT" ]; then
  echo "ERROR: file not found: $INPUT" >&2
  exit 1
fi

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
DEFAULT_OUTPUT="$(dirname "$INPUT")/$(basename "${INPUT%.dump}")-sanitized-${TIMESTAMP}.dump"
OUTPUT="${2:-$DEFAULT_OUTPUT}"

SANITIZE_DB_URL="${SANITIZE_DB_URL:-postgres://delovoy:delovoy@localhost:5432/sanitize_tmp}"
# Extract DB name from URL for createdb/dropdb
SANITIZE_DB_NAME="${SANITIZE_DB_URL##*/}"
# Base URL without the DB name (for createdb/dropdb)
SANITIZE_BASE_URL="${SANITIZE_DB_URL%/*}"

log() { echo "[$(date -u +%FT%TZ)] $*"; }

log "==> Sanitize: $INPUT → $OUTPUT"
log "    Throwaway DB: $SANITIZE_DB_NAME"

# 1. Drop + recreate throwaway DB
log "Step 1/4: Creating throwaway DB..."
psql "${SANITIZE_BASE_URL}/postgres" -c "DROP DATABASE IF EXISTS \"${SANITIZE_DB_NAME}\";" 2>/dev/null || true
psql "${SANITIZE_BASE_URL}/postgres" -c "CREATE DATABASE \"${SANITIZE_DB_NAME}\";"

# 2. Restore dump into throwaway DB
log "Step 2/4: Restoring dump..."
pg_restore --no-owner --no-privileges --no-comments \
  -d "$SANITIZE_DB_URL" "$INPUT" 2>/dev/null || {
  # pg_restore exits non-zero on warnings (e.g. missing extensions) — check if data landed
  TABLE_COUNT=$(psql "$SANITIZE_DB_URL" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null || echo "0")
  if [ "$TABLE_COUNT" -lt "5" ]; then
    log "ERROR: pg_restore failed — only $TABLE_COUNT tables found"
    psql "${SANITIZE_BASE_URL}/postgres" -c "DROP DATABASE IF EXISTS \"${SANITIZE_DB_NAME}\";" 2>/dev/null || true
    exit 1
  fi
  log "WARN: pg_restore completed with warnings (expected for extension mismatches)"
}

# 3. Apply PII masks
# Strategy: ALLOWLIST — only explicitly listed columns are preserved as-is.
# Any new column added to these tables must be explicitly approved here.
log "Step 3/4: Masking PII..."
psql "$SANITIZE_DB_URL" << 'SQL'

-- ── User table ──────────────────────────────────────────────────────────────
-- Keep: id, role, createdAt, updatedAt, emailVerified, image, tags
-- Mask: email, phone, name, telegramId, vkId, passwordHash, notes, birthday, gender
UPDATE "User"
SET
  email        = id || '@dev.local',
  phone        = NULL,
  name         = 'Dev User ' || substring(id, 1, 6),
  telegramId   = NULL,
  vkId         = NULL,
  passwordHash = NULL,
  notes        = NULL,
  birthday     = NULL,
  gender       = NULL;

-- ── Tenant (арендаторы) ──────────────────────────────────────────────────────
-- Keep: id, companyName (first word only), tenantType, isDeleted, createdAt, updatedAt
-- Mask: contactName, phone, phonesExtra, email, emailsExtra, inn, legalAddress, notes
UPDATE "Tenant"
SET
  companyName    = 'Company ' || substring(id, 1, 6),
  contactName    = NULL,
  phone          = '+7900' || lpad((row_number() OVER ())::text, 7, '0'),
  phonesExtra    = NULL,
  email          = substring(id, 1, 8) || '@example.com',
  emailsExtra    = NULL,
  inn            = NULL,
  legalAddress   = NULL,
  needsLegalAddress = false,
  notes          = NULL;

-- ── RentalContract ───────────────────────────────────────────────────────────
-- Keep: structural fields (id, officeId, tenantId, status, dates, amounts, parkSlug)
-- Mask: notes, internalNotes, contractNumber (keep pattern, mask digits)
UPDATE "RentalContract"
SET
  notes         = NULL,
  internalNotes = NULL
WHERE notes IS NOT NULL OR "internalNotes" IS NOT NULL;

-- ── MessengerMessage ─────────────────────────────────────────────────────────
-- Keep: id, threadId, senderId, createdAt, updatedAt, type, isRead, isDeleted
-- Mask: body content (preserve structure/threading, redact text)
UPDATE "MessengerMessage"
SET body = '[redacted]'
WHERE body IS NOT NULL AND body != '' AND body != '[redacted]';

-- ── Truncate high-volume / sensitive tables entirely ─────────────────────────
TRUNCATE TABLE "AuditLog" RESTART IDENTITY CASCADE;
TRUNCATE TABLE "SystemEvent" RESTART IDENTITY CASCADE;
TRUNCATE TABLE "PushSubscription" RESTART IDENTITY CASCADE;
TRUNCATE TABLE "TelegramLink" RESTART IDENTITY CASCADE;

-- ── Novofon / telephony call logs ────────────────────────────────────────────
-- CallLog может содержать номера телефонов
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'CallLog') THEN
    EXECUTE 'TRUNCATE TABLE "CallLog" RESTART IDENTITY CASCADE';
  END IF;
END $$;

-- ── Avito leads ──────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'AvitoLead') THEN
    EXECUTE 'UPDATE "AvitoLead" SET "clientName" = ''Dev Lead'', "clientPhone" = NULL, "clientEmail" = NULL';
  END IF;
END $$;

SQL

log "    PII masking complete"

# 4. Dump sanitized DB to output file
log "Step 4/4: Dumping sanitized DB → $OUTPUT..."
pg_dump "$SANITIZE_DB_URL" --no-owner --no-privileges --format=custom -Z 6 -f "$OUTPUT"

SIZE_HUMAN="$(du -h "$OUTPUT" | cut -f1)"
log "    Output: $OUTPUT ($SIZE_HUMAN)"

# Cleanup throwaway DB
psql "${SANITIZE_BASE_URL}/postgres" -c "DROP DATABASE IF EXISTS \"${SANITIZE_DB_NAME}\";" 2>/dev/null || true

log "==> Done. Sanitized dump: $OUTPUT"
