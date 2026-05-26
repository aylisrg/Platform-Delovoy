#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client';
import { DbLogReader, FileLogReader, LogReader } from './lib/log-reader';
import { PatternExtractor, ErrorPattern } from './lib/pattern-extractor';
import { GitHubIssueCreator } from './lib/github-issues';

interface AnalyzerOptions {
  hours: number;
  baselineDays: number;
  dryRun: boolean;
  dbOnly: boolean;
  maxIssues: number;
}

class ErrorAnalyzer {
  private prisma: PrismaClient;
  private patternExtractor: PatternExtractor;
  private issueCreator: GitHubIssueCreator;

  constructor() {
    this.prisma = new PrismaClient();
    this.patternExtractor = new PatternExtractor();
    this.issueCreator = new GitHubIssueCreator();
  }

  async analyze(options: AnalyzerOptions): Promise<void> {
    console.log('🔍 Starting error log analysis...\n');

    // Calculate time windows
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

    // Collect logs from all sources
    const readers = this.getLogReaders(options);
    console.log(`Using ${readers.length} log reader(s)\n`);

    // Read current logs
    console.log('📖 Reading current logs...');
    const currentLogs = await this.readLogs(readers, currentWindowStart, now);
    console.log(`Found ${currentLogs.length} error entries in current window\n`);

    // Read baseline logs
    console.log('📖 Reading baseline logs...');
    const baselineLogs = await this.readLogs(readers, baselineWindowStart, baselineWindowEnd);
    console.log(`Found ${baselineLogs.length} error entries in baseline window\n`);

    // Extract patterns
    console.log('🔬 Extracting error patterns...');
    const currentPatterns = this.patternExtractor.extract(currentLogs);
    const baselinePatterns = this.patternExtractor.extract(baselineLogs);
    console.log(`Current patterns: ${currentPatterns.length}`);
    console.log(`Baseline patterns: ${baselinePatterns.length}\n`);

    // Find new patterns
    const newPatterns = this.findNewPatterns(currentPatterns, baselinePatterns);
    console.log(`🆕 Found ${newPatterns.length} new error pattern(s)\n`);

    if (newPatterns.length === 0) {
      console.log('✅ No new error patterns detected. All clear!');
      await this.cleanup();
      return;
    }

    // Sort by count (most frequent first) and limit
    const topPatterns = newPatterns.sort((a, b) => b.count - a.count).slice(0, options.maxIssues);

    if (newPatterns.length > options.maxIssues) {
      console.log(`⚠️  Limiting to top ${options.maxIssues} patterns to prevent spam\n`);
    }

    // Create GitHub issues
    console.log('📝 Creating GitHub issues...\n');
    let created = 0;

    for (const pattern of topPatterns) {
      console.log(`\nPattern: ${pattern.fingerprint}`);
      console.log(`  Source: ${pattern.source}`);
      console.log(`  Count: ${pattern.count}`);
      console.log(`  Message: ${pattern.sampleMessage.substring(0, 100)}...`);

      const issueUrl = await this.issueCreator.createIssue(pattern, options.dryRun);
      if (issueUrl) {
        created++;
      }
    }

    console.log(`\n✅ Created ${created} issue(s)`);
    await this.cleanup();
  }

  private getLogReaders(options: AnalyzerOptions): LogReader[] {
    const readers: LogReader[] = [];

    // Always include DB reader
    readers.push(new DbLogReader(this.prisma));

    // Add file reader if not db-only and SSH configured
    if (!options.dbOnly && process.env.SSH_HOST) {
      const sshHost = process.env.SSH_HOST;
      const logPath = process.env.SSH_LOG_PATH || '/var/log/delovoy/error.log';
      readers.push(new FileLogReader(sshHost, logPath));
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
    await this.prisma.$disconnect();
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
    maxIssues: 5,
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
  --dry-run            Don't create issues, just print what would be created
  --db-only            Skip file logs, use SystemEvent DB only
  --max-issues <N>     Maximum number of issues to create (default: 5)
  --help               Show this help message

Environment Variables:
  DATABASE_URL         Prisma database connection (required)
  SSH_HOST             VPS host for file logs (e.g., root@example.com)
  SSH_LOG_PATH         Path to error log on VPS (default: /var/log/delovoy/error.log)
  GITHUB_TOKEN         GitHub token (only needed if gh CLI not authenticated)

Examples:
  npx tsx scripts/analyze-errors.ts
  npx tsx scripts/analyze-errors.ts --dry-run
  npx tsx scripts/analyze-errors.ts --db-only --hours 48
  npx tsx scripts/analyze-errors.ts --baseline-days 14 --max-issues 10
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
