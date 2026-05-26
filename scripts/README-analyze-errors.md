# Error Log Analyzer

Automated error pattern detection and GitHub issue creation for Platform Delovoy.

## Overview

`analyze-errors.ts` monitors error logs from multiple sources, identifies new error patterns, and automatically creates GitHub issues for investigation. It helps catch regressions and new failure modes before they impact users.

## Features

- **Multi-source log aggregation**: Reads from SystemEvent DB + file logs via SSH
- **Pattern fingerprinting**: Groups errors by normalized message patterns
- **Baseline comparison**: Compares current errors against historical 7-day window
- **Automatic issue creation**: Creates GitHub issues via `gh` CLI
- **Duplicate prevention**: Checks existing issues before creating new ones
- **Rate limiting**: Max 5 issues per run to prevent spam

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
| `--max-issues <N>` | 5 | Maximum issues to create per run |
| `--help` | - | Show help message |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Prisma database connection string |
| `SSH_HOST` | No | VPS host for file logs (e.g., `root@delovoy-park.ru`) |
| `SSH_LOG_PATH` | No | Path to error log on VPS (default: `/var/log/delovoy/error.log`) |
| `GITHUB_TOKEN` | No | GitHub token (only if `gh` CLI not authenticated) |

## How It Works

### 1. Log Collection

Reads error logs from two sources:

**DB Source (`DbLogReader`)**:
- Queries `SystemEvent` table for ERROR/CRITICAL level events
- Time-filtered by `createdAt` field
- Always available

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

**Labels**: `bug`, `auto-detected`

**Duplicate Check**: Searches for open issues with same fingerprint before creating

## Example Usage

### Daily Monitoring (Cron)
```bash
# Add to crontab on VPS
0 9 * * * cd /app && npm run analyze-errors >> /var/log/error-analysis.log 2>&1
```

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
│   └── github-issues.ts        # gh CLI wrapper
└── __tests__/
    ├── log-reader.test.ts      # LogReader tests
    └── pattern-extractor.test.ts # PatternExtractor tests
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

### "gh: command not found"

Install GitHub CLI:
```bash
# macOS
brew install gh

# Ubuntu/Debian
sudo apt install gh

# Authenticate
gh auth login
```

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
- All inputs sanitized before shell execution

## Future Enhancements

- [ ] Slack/Telegram notifications via existing bot
- [ ] Web UI for pattern management
- [ ] Auto-close issues when pattern disappears
- [ ] Pattern severity scoring (based on frequency + level)
- [ ] Integration with monitoring dashboard

## Related

- `src/modules/monitoring/service.ts` - SystemEvent creation
- `docs/monitoring.md` - Overall monitoring strategy
- `CLAUDE.md` - Architecture conventions
