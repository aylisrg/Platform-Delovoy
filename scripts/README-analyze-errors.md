# Error Log Analyzer

Automated error pattern detection and GitHub issue creation for Platform Delovoy.

## Overview

`analyze-errors.ts` monitors error logs from multiple sources, identifies new error patterns, and automatically creates GitHub issues for investigation. It helps catch regressions and new failure modes before they impact users.

## Features

- **Multi-source log aggregation**: SystemEvent DB, psql-дамп (`--events-file`) или file logs via SSH
- **Pattern fingerprinting**: Groups errors by normalized message patterns
- **Baseline comparison**: Compares current errors against historical 7-day window
- **WARNING spikes**: всплески `client-beacon`/`rate-limit` против недельного базлайна (≥50/сутки и ≥3×)
- **Automatic issue creation**: issues сразу с `prio:*` + `auto:ready` — их видит автоочередь; API через curl (`ghApi`), не `gh` CLI
- **Duplicate prevention**: маркер `<!-- error-fingerprint:… -->` / `<!-- warning-spike:… -->` в теле issue
- **Rate limiting**: Max 5 pattern-issues per run to prevent spam

Продовый запуск — ежедневный workflow `.github/workflows/backlog-intake.yml`
(SSH-дамп → `--events-file`), см. ADR `docs/architecture/2026-08-11-backlog-intake-adr.md`.

## Quick Start

```bash
# Basic run (both DB + file logs, creates issues)
npm run analyze-errors

# Dry run (preview what would be created)
npm run analyze-errors -- --dry-run

# DB-only mode (no SSH required)
npm run analyze-errors -- --db-only
```

## CLI Options

| Option | Default | Description |
|--------|---------|-------------|
| `--hours <N>` | 24 | Look back N hours for current errors |
| `--baseline-days <N>` | 7 | Use N days for baseline comparison |
| `--dry-run` | false | Don't create issues, just preview |
| `--db-only` | false | Skip file logs, use SystemEvent DB only |
| `--max-issues <N>` | 5 | Maximum pattern issues to create per run |
| `--events-file <path>` | - | Read events from a psql `json_agg` dump (no DB needed) |
| `--help` | - | Show help message |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Only without `--events-file` | Prisma database connection string |
| `SSH_HOST` | No | VPS host for file logs (e.g., `root@delovoy-park.ru`) |
| `SSH_LOG_PATH` | No | Path to error log on VPS (default: `/var/log/delovoy/error.log`) |
| `GH_TOKEN` | In Actions | GitHub token; сессии Claude Code ходят через agent-proxy без токена |

## How It Works

### 1. Log Collection

Reads error logs from two sources:

**DB Source (`DbLogReader`)**:
- Queries `SystemEvent`: ERROR/CRITICAL целиком + WARNING для `client-beacon`/`rate-limit`
- Time-filtered by `createdAt` field

**Dump Source (`JsonEventsReader`, `--events-file`)**:
- psql `json_agg`-дамп, снятый по SSH в `backlog-intake.yml` (прод-БД недоступна раннерам)
- Не требует Prisma/DATABASE_URL

**File Source (`FileLogReader`)**:
- Connects via SSH to VPS
- Reads log files (auto-detects JSON, syslog formats)
- Optional (skips if SSH unavailable)

### 2. Pattern Extraction

**Fingerprinting Algorithm**:
```
fingerprint = sha256(source + normalized_message).substring(0, 12)
```

**Message Normalization**:
- UUIDs → `<UUID>`
- Timestamps → `<TIMESTAMP>`
- IP addresses → `<IP>`
- Line numbers → `:<N>`
- Numbers → `<N>`
- File paths → `<PATH>`
- Truncate to 200 chars

Example:
```
Before: "BOOKING_CONFLICT: Slot abc-123 already taken at 2026-05-10T10:00:00Z"
After:  "BOOKING_CONFLICT: Slot <UUID> already taken at <TIMESTAMP>"
```

### 3. Baseline Comparison

1. Extract patterns from **current window** (last 24h)
2. Extract patterns from **baseline window** (7 days ago)
3. New patterns = patterns in current **not in** baseline

### 4. Issue Creation

For each new pattern (up to 5):

**Issue Title**:
```
🔴 New error pattern: api/booking: BOOKING_CONFLICT: Slot already...
```

**Issue Body**:
```markdown
## New Error Pattern Detected

**Fingerprint:** `abc123xyz`
**Source:** `api/booking`
**First seen:** 2026-05-10T08:23:45Z
**Last seen:** 2026-05-10T09:01:33Z
**Occurrences (24h):** 47

### Sample Message
BOOKING_CONFLICT: Slot already taken for resource xyz

### Examples (last 3)
1. 2026-05-10 08:23:45 - metadata: {...}
2. 2026-05-10 08:35:12 - metadata: {...}
3. 2026-05-10 09:01:33 - metadata: {...}
```

**Labels**: `bug`, `auto-detected`, `prio:P1|P2`, `auto:ready`
(CRITICAL или ERROR ≥20/сутки → P1, иначе P2; всплески WARNING — всегда P2)

**Duplicate Check**: маркер fingerprint в телах открытых `auto-detected` issues

## Example Usage

### Daily Monitoring
Работает из коробки: `.github/workflows/backlog-intake.yml`, ежедневно 03:43 UTC
(плюс ручной `workflow_dispatch` с `dry_run`). Крон на VPS не нужен.

### Custom Time Windows
```bash
# Last 48 hours vs 14-day baseline
npm run analyze-errors -- --hours 48 --baseline-days 14

# Quick check (last 6 hours)
npm run analyze-errors -- --hours 6 --dry-run
```

### Local Development
```bash
# Test without SSH (DB only)
npm run analyze-errors -- --db-only --dry-run

# Preview what would be created
npm run analyze-errors -- --dry-run
```

## File Structure

```
scripts/
├── analyze-errors.ts           # Main entry point
├── lib/
│   ├── log-reader.ts           # LogReader interface + DB/File adapters
│   ├── pattern-extractor.ts    # Fingerprinting + grouping logic
│   ├── gh-api.ts               # curl-обёртка GitHub API (общая с issue-queue)
│   └── github-issues.ts        # мост «паттерн → issue очереди»
└── __tests__/
    ├── log-reader.test.ts      # LogReader tests
    ├── pattern-extractor.test.ts # PatternExtractor + spikes tests
    └── github-issues.test.ts   # label bridge + issue bodies
```

## Testing

```bash
# Run all tests
npm test -- scripts/__tests__

# Watch mode
npm run test:watch -- scripts/__tests__

# Coverage
npm run test:coverage -- scripts/__tests__
```

## Troubleshooting

### "SSH connection failed"

Check:
1. `SSH_HOST` environment variable is set
2. SSH key is configured for passwordless login
3. VPS is reachable: `ssh $SSH_HOST "echo test"`

Workaround: Use `--db-only` flag

### "No new patterns but I see errors"

This means the errors existed in the baseline window (7 days ago). Adjust with:
```bash
npm run analyze-errors -- --baseline-days 30  # Longer baseline
```

### "Too many issues created"

Reduce max issues:
```bash
npm run analyze-errors -- --max-issues 3
```

## Security Notes

- SSH keys should be read-only for log files
- GitHub token (if used) needs `repo` scope for issue creation
- Log parsing is safe (no code execution from log content)
- Сообщения ошибок не проходят через shell вовсе: issue создаётся curl-ом с
  JSON-телом (`ghApi`), в теле issue текст огорожен и помечен как данные

## Future Enhancements

- [ ] Slack/Telegram notifications via existing bot
- [ ] Web UI for pattern management
- [ ] Auto-close issues when pattern disappears
- [x] Pattern severity scoring (based on frequency + level) → `labelsForPattern`
- [ ] Integration with monitoring dashboard

## Related

- `src/modules/monitoring/service.ts` - SystemEvent creation
- `docs/monitoring.md` - Overall monitoring strategy
- `CLAUDE.md` - Architecture conventions
