#!/usr/bin/env tsx
/**
 * Анализатор ошибок прода → issues автоочереди.
 *
 * Читает SystemEvent (ERROR/CRITICAL + WARNING-потоки client-beacon/rate-limit),
 * фингерпринтует ошибки, сравнивает с базлайном недельной давности и заводит
 * issue на каждый НОВЫЙ паттерн — сразу с `prio:*` + `auto:ready`, чтобы
 * автоочередь взяла их без человека. Отдельно ловит всплески WARNING.
 *
 * Режимы:
 *   --events-file dump.json  события из дампа (workflow backlog-intake.yml:
 *                            прод-Postgres недоступен раннерам, дамп приезжает
 *                            по SSH); БД и DATABASE_URL не нужны
 *   (без флага)              напрямую из БД через Prisma (локально/на VPS)
 */
import type { PrismaClient } from '@prisma/client';
import {
  DbLogReader,
  FileLogReader,
  JsonEventsReader,
  LogEntry,
  LogReader,
} from './lib/log-reader';
import {
  DEFAULT_SPIKE_OPTIONS,
  ErrorPattern,
  PatternExtractor,
  detectWarningSpikes,
} from './lib/pattern-extractor';
import { GitHubIssueCreator } from './lib/github-issues';

interface AnalyzerOptions {
  hours: number;
  baselineDays: number;
  dryRun: boolean;
  dbOnly: boolean;
  maxIssues: number;
  eventsFile: string | null;
}

const isError = (e: LogEntry) => e.level === 'ERROR' || e.level === 'CRITICAL';
const isWarning = (e: LogEntry) => e.level === 'WARNING';

class ErrorAnalyzer {
  // Ленивый: в режиме --events-file Prisma не нужна вовсе (на раннере нет DATABASE_URL).
  private prisma: PrismaClient | null = null;
  private patternExtractor = new PatternExtractor();
  private issueCreator = new GitHubIssueCreator();

  async analyze(options: AnalyzerOptions): Promise<void> {
    console.log('🔍 Starting error log analysis...\n');

    const now = new Date();
    const currentWindowStart = new Date(now.getTime() - options.hours * 60 * 60 * 1000);
    const baselineWindowEnd = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const baselineWindowStart = new Date(
      baselineWindowEnd.getTime() - options.baselineDays * 24 * 60 * 60 * 1000
    );

    console.log(`Current window: ${currentWindowStart.toISOString()} → ${now.toISOString()}`);
    console.log(
      `Baseline window: ${baselineWindowStart.toISOString()} → ${baselineWindowEnd.toISOString()}\n`
    );

    const readers = await this.getLogReaders(options);
    console.log(`Using ${readers.length} log reader(s)\n`);

    console.log('📖 Reading current logs...');
    const currentLogs = await this.readLogs(readers, currentWindowStart, now);
    console.log(`Found ${currentLogs.length} entries in current window\n`);

    console.log('📖 Reading baseline logs...');
    const baselineLogs = await this.readLogs(readers, baselineWindowStart, baselineWindowEnd);
    console.log(`Found ${baselineLogs.length} entries in baseline window\n`);

    // Фингерпринты — только для ERROR/CRITICAL. WARNING-потоки слишком
    // разнородны по тексту, их сигнал — объём (всплески ниже).
    console.log('🔬 Extracting error patterns...');
    const currentPatterns = this.patternExtractor.extract(currentLogs.filter(isError));
    const baselinePatterns = this.patternExtractor.extract(baselineLogs.filter(isError));
    console.log(`Current patterns: ${currentPatterns.length}`);
    console.log(`Baseline patterns: ${baselinePatterns.length}\n`);

    const newPatterns = this.findNewPatterns(currentPatterns, baselinePatterns);
    console.log(`🆕 Found ${newPatterns.length} new error pattern(s)\n`);

    let created = 0;

    if (newPatterns.length > 0) {
      const topPatterns = newPatterns.sort((a, b) => b.count - a.count).slice(0, options.maxIssues);
      if (newPatterns.length > options.maxIssues) {
        console.log(`⚠️  Limiting to top ${options.maxIssues} patterns to prevent spam\n`);
      }

      console.log('📝 Creating GitHub issues...\n');
      for (const pattern of topPatterns) {
        console.log(`\nPattern: ${pattern.fingerprint}`);
        console.log(`  Source: ${pattern.source}`);
        console.log(`  Level: ${pattern.level}, count: ${pattern.count}`);
        console.log(`  Message: ${pattern.sampleMessage.substring(0, 100)}...`);
        if (await this.issueCreator.createIssue(pattern, options.dryRun)) created++;
      }
    }

    // Всплески WARNING (client-beacon, rate-limit): сравниваем темп текущего
    // окна с базлайном по каждому source.
    console.log('\n📈 Checking WARNING spikes...');
    const spikes = detectWarningSpikes(currentLogs.filter(isWarning), baselineLogs.filter(isWarning), {
      ...DEFAULT_SPIKE_OPTIONS,
      hours: options.hours,
      baselineDays: options.baselineDays,
    });
    console.log(`Found ${spikes.length} spike(s)\n`);
    for (const spike of spikes) {
      console.log(`  ${spike.source}: ${spike.count} за ${options.hours}ч (базлайн ${spike.baselinePerDay}/сутки)`);
      if (await this.issueCreator.createSpikeIssue(spike, options.hours, options.dryRun)) created++;
    }

    console.log(`\n✅ Created ${created} issue(s)`);
    await this.cleanup();
  }

  private async getLogReaders(options: AnalyzerOptions): Promise<LogReader[]> {
    if (options.eventsFile) {
      return [new JsonEventsReader(options.eventsFile)];
    }

    const { PrismaClient } = await import('@prisma/client');
    this.prisma = new PrismaClient();
    const readers: LogReader[] = [new DbLogReader(this.prisma)];

    if (!options.dbOnly && process.env.SSH_HOST) {
      const logPath = process.env.SSH_LOG_PATH || '/var/log/delovoy/error.log';
      readers.push(new FileLogReader(process.env.SSH_HOST, logPath));
    }
    return readers;
  }

  private async readLogs(readers: LogReader[], since: Date, until: Date) {
    const allLogs = await Promise.all(readers.map((reader) => reader.read(since, until)));
    return allLogs.flat();
  }

  private findNewPatterns(current: ErrorPattern[], baseline: ErrorPattern[]): ErrorPattern[] {
    const baselineFingerprints = new Set(baseline.map((p) => p.fingerprint));
    return current.filter((p) => !baselineFingerprints.has(p.fingerprint));
  }

  private async cleanup() {
    await this.prisma?.$disconnect();
  }
}

// Parse CLI arguments
function parseArgs(): AnalyzerOptions {
  const args = process.argv.slice(2);
  const options: AnalyzerOptions = {
    hours: 24,
    baselineDays: 7,
    dryRun: false,
    dbOnly: false,
    // Issue #576: с появлением server-error (onRequestError, свежий
    // источник паттернов) хвост суточного всплеска не должен ждать
    // следующего прогона backlog-intake.yml — потолок поднят с 5 до 10.
    maxIssues: 10,
    eventsFile: null,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--hours':
        options.hours = parseInt(args[++i], 10);
        break;
      case '--baseline-days':
        options.baselineDays = parseInt(args[++i], 10);
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--db-only':
        options.dbOnly = true;
        break;
      case '--max-issues':
        options.maxIssues = parseInt(args[++i], 10);
        break;
      case '--events-file':
        options.eventsFile = args[++i] ?? null;
        break;
      case '--help':
        printHelp();
        process.exit(0);
        break;
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Usage: npx tsx scripts/analyze-errors.ts [options]

Options:
  --hours <N>           Look back N hours for current errors (default: 24)
  --baseline-days <N>   Use N days for baseline comparison (default: 7)
  --dry-run             Don't create issues, just print what would be created
  --db-only             Skip file logs, use SystemEvent DB only
  --max-issues <N>      Maximum number of pattern issues to create (default: 10)
  --events-file <path>  Read events from a psql json_agg dump instead of the DB
                        (no DATABASE_URL needed; used by backlog-intake.yml)
  --help                Show this help message

Environment Variables:
  DATABASE_URL         Prisma database connection (not needed with --events-file)
  SSH_HOST             VPS host for file logs (e.g., root@example.com)
  SSH_LOG_PATH         Path to error log on VPS (default: /var/log/delovoy/error.log)
  GH_TOKEN             GitHub token (used in Actions; sessions go via agent-proxy)

Examples:
  npx tsx scripts/analyze-errors.ts --dry-run
  npx tsx scripts/analyze-errors.ts --events-file events.json
  npx tsx scripts/analyze-errors.ts --db-only --hours 48
`);
}

// Main execution
async function main() {
  const options = parseArgs();
  const analyzer = new ErrorAnalyzer();

  try {
    await analyzer.analyze(options);
  } catch (error) {
    console.error('❌ Analysis failed:', error);
    process.exit(1);
  }
}

main();
