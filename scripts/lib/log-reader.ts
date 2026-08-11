import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

export interface LogEntry {
  timestamp: Date;
  level: 'ERROR' | 'CRITICAL' | 'WARNING';
  source: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface LogReader {
  read(since: Date, until: Date): Promise<LogEntry[]>;
}

/**
 * WARNING-источники, которые анализатор всё же читает. Поодиночке такие события
 * безобидны (429, ошибка в браузере клиента), сигналом становится всплеск —
 * его ловит detectWarningSpikes, а не фингерпринты.
 */
export const WARNING_SOURCES = ['client-beacon', 'rate-limit'] as const;

export class DbLogReader implements LogReader {
  constructor(private prisma: PrismaClient) {}

  async read(since: Date, until: Date): Promise<LogEntry[]> {
    const events = await this.prisma.systemEvent.findMany({
      where: {
        createdAt: { gte: since, lte: until },
        OR: [
          { level: { in: ['ERROR', 'CRITICAL'] } },
          { level: 'WARNING', source: { in: [...WARNING_SOURCES] } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    return events.map((event) => ({
      timestamp: event.createdAt,
      level: event.level as 'ERROR' | 'CRITICAL' | 'WARNING',
      source: event.source,
      message: event.message,
      metadata: event.metadata as Record<string, unknown> | undefined,
    }));
  }
}

const VALID_LEVELS = new Set(['ERROR', 'CRITICAL', 'WARNING']);

/**
 * Парсит дамп SystemEvent, снятый с прода через `psql ... json_agg` (см.
 * .github/workflows/backlog-intake.yml — прод-Postgres недоступен раннерам
 * напрямую, дамп приезжает по SSH). Невалидные строки молча пропускаются:
 * одна битая запись не должна ронять весь интейк.
 */
export function parseSystemEventsJson(raw: string): LogEntry[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('дамп SystemEvent — не JSON-массив');
  }
  const entries: LogEntry[] = [];
  for (const row of parsed as Record<string, unknown>[]) {
    const level = String(row.level ?? '');
    const source = row.source;
    const message = row.message;
    const timestamp = new Date(String(row.createdAt ?? ''));
    if (!VALID_LEVELS.has(level)) continue;
    if (typeof source !== 'string' || typeof message !== 'string') continue;
    if (Number.isNaN(timestamp.getTime())) continue;
    entries.push({
      timestamp,
      level: level as LogEntry['level'],
      source,
      message,
      metadata: (row.metadata ?? undefined) as Record<string, unknown> | undefined,
    });
  }
  return entries;
}

/** Читает события из файла-дампа (json_agg) — режим `--events-file` анализатора. */
export class JsonEventsReader implements LogReader {
  constructor(private filePath: string) {}

  async read(since: Date, until: Date): Promise<LogEntry[]> {
    const raw = readFileSync(this.filePath, 'utf8');
    return parseSystemEventsJson(raw).filter((e) => e.timestamp >= since && e.timestamp <= until);
  }
}

export class FileLogReader implements LogReader {
  constructor(
    private sshHost: string,
    private logPath: string = '/var/log/delovoy/error.log'
  ) {}

  async read(since: Date, until: Date): Promise<LogEntry[]> {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      // Read log file via SSH
      const { stdout } = await execAsync(
        `ssh ${this.sshHost} "cat ${this.logPath}"`
      );

      return this.parseLogContent(stdout, since, until);
    } catch (error) {
      console.warn('Failed to read file logs via SSH:', error);
      return [];
    }
  }

  private parseLogContent(content: string, since: Date, until: Date): LogEntry[] {
    const entries: LogEntry[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        // Try JSON format first
        const parsed = JSON.parse(line);
        const timestamp = new Date(parsed.timestamp || parsed.time || parsed.date);

        if (timestamp >= since && timestamp <= until) {
          const level = this.normalizeLevel(parsed.level);
          if (level === 'ERROR' || level === 'CRITICAL') {
            entries.push({
              timestamp,
              level,
              source: parsed.source || parsed.component || 'file-log',
              message: parsed.message || parsed.msg || line,
              metadata: parsed.metadata || parsed.context,
            });
          }
        }
      } catch {
        // Try common log formats (nginx, syslog)
        const match = line.match(/^(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2})/);
        if (match) {
          const timestamp = new Date(match[1].replace(' ', 'T') + 'Z');
          if (!isNaN(timestamp.getTime()) && timestamp >= since && timestamp <= until) {
            if (line.toLowerCase().includes('error') || line.toLowerCase().includes('critical')) {
              entries.push({
                timestamp,
                level: line.toLowerCase().includes('critical') ? 'CRITICAL' : 'ERROR',
                source: 'file-log',
                message: line,
              });
            }
          }
        }
      }
    }

    return entries;
  }

  private normalizeLevel(level: string): 'ERROR' | 'CRITICAL' | 'WARNING' {
    const normalized = level?.toLowerCase();
    if (normalized === 'critical' || normalized === 'fatal') return 'CRITICAL';
    if (normalized === 'warning' || normalized === 'warn') return 'WARNING';
    return 'ERROR';
  }
}
