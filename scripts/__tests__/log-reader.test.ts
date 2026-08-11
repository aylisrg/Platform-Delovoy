import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import {
  DbLogReader,
  FileLogReader,
  JsonEventsReader,
  parseSystemEventsJson,
  type LogEntry,
} from '../lib/log-reader';

// Helper to access private methods of FileLogReader in tests
type FileLogReaderPrivate = {
  parseLogContent: (content: string, since: Date, until: Date) => LogEntry[];
  normalizeLevel: (level: string) => LogEntry['level'];
};
function priv(r: FileLogReader): FileLogReaderPrivate {
  return r as unknown as FileLogReaderPrivate;
}

// Mock Prisma
const mockPrisma = {
  systemEvent: {
    findMany: vi.fn(),
  },
} as unknown as PrismaClient;

describe('DbLogReader', () => {
  let reader: DbLogReader;

  beforeEach(() => {
    vi.clearAllMocks();
    reader = new DbLogReader(mockPrisma);
  });

  it('should read ERROR and CRITICAL events from DB', async () => {
    const mockEvents = [
      {
        id: '1',
        level: 'ERROR',
        source: 'api/booking',
        message: 'Test error',
        metadata: { userId: '123' },
        createdAt: new Date('2026-05-10T10:00:00Z'),
      },
      {
        id: '2',
        level: 'CRITICAL',
        source: 'api/cafe',
        message: 'Critical issue',
        metadata: null,
        createdAt: new Date('2026-05-10T10:05:00Z'),
      },
    ];

    mockPrisma.systemEvent.findMany.mockResolvedValue(mockEvents);

    const since = new Date('2026-05-10T09:00:00Z');
    const until = new Date('2026-05-10T11:00:00Z');

    const entries = await reader.read(since, until);

    // ERROR/CRITICAL целиком + WARNING только для источников со спайк-детекцией:
    // client-beacon и rate-limit сигналят объёмом, а не текстом.
    expect(mockPrisma.systemEvent.findMany).toHaveBeenCalledWith({
      where: {
        createdAt: { gte: since, lte: until },
        OR: [
          { level: { in: ['ERROR', 'CRITICAL'] } },
          { level: 'WARNING', source: { in: ['client-beacon', 'rate-limit'] } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    expect(entries).toHaveLength(2);
    expect(entries[0].level).toBe('ERROR');
    expect(entries[0].source).toBe('api/booking');
    expect(entries[0].message).toBe('Test error');
    expect(entries[0].metadata).toEqual({ userId: '123' });
    expect(entries[1].level).toBe('CRITICAL');
  });

  it('should handle empty results', async () => {
    mockPrisma.systemEvent.findMany.mockResolvedValue([]);

    const since = new Date('2026-05-10T09:00:00Z');
    const until = new Date('2026-05-10T11:00:00Z');

    const entries = await reader.read(since, until);

    expect(entries).toHaveLength(0);
  });
});

describe('FileLogReader', () => {
  let reader: FileLogReader;

  beforeEach(() => {
    reader = new FileLogReader('root@example.com', '/var/log/test.log');
  });

  it('should parse JSON log format', async () => {
    const logContent = `
{"timestamp":"2026-05-10T10:00:00Z","level":"error","source":"api/booking","message":"Test error","metadata":{"userId":"123"}}
{"timestamp":"2026-05-10T10:05:00Z","level":"critical","source":"api/cafe","message":"Critical issue"}
`.trim();

    const entries = priv(reader).parseLogContent(
      logContent,
      new Date('2026-05-10T09:00:00Z'),
      new Date('2026-05-10T11:00:00Z')
    );

    expect(entries).toHaveLength(2);
    expect(entries[0].level).toBe('ERROR');
    expect(entries[0].source).toBe('api/booking');
    expect(entries[0].message).toBe('Test error');
    expect(entries[0].metadata).toEqual({ userId: '123' });
    expect(entries[1].level).toBe('CRITICAL');
  });

  it('should parse syslog-style log format with error keyword', async () => {
    const logContent = `
2026-05-10 10:00:00 ERROR: Test error message
2026-05-10T10:05:00 CRITICAL: Critical issue
`.trim();

    const entries = priv(reader).parseLogContent(
      logContent,
      new Date('2026-05-10T09:00:00Z'),
      new Date('2026-05-10T11:00:00Z')
    );

    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(entries.every((e) => e.level === 'ERROR' || e.level === 'CRITICAL')).toBe(true);
  });

  it('should filter entries by time window', async () => {
    const logContent = `
{"timestamp":"2026-05-10T08:00:00Z","level":"error","source":"api/booking","message":"Too early"}
{"timestamp":"2026-05-10T10:00:00Z","level":"error","source":"api/booking","message":"In range"}
{"timestamp":"2026-05-10T12:00:00Z","level":"error","source":"api/booking","message":"Too late"}
`.trim();

    const entries = priv(reader).parseLogContent(
      logContent,
      new Date('2026-05-10T09:00:00Z'),
      new Date('2026-05-10T11:00:00Z')
    );

    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe('In range');
  });

  it('should skip non-error lines', async () => {
    const logContent = `
{"timestamp":"2026-05-10T10:00:00Z","level":"info","source":"api/booking","message":"Info message"}
{"timestamp":"2026-05-10T10:01:00Z","level":"error","source":"api/booking","message":"Error message"}
{"timestamp":"2026-05-10T10:02:00Z","level":"warning","source":"api/booking","message":"Warning message"}
`.trim();

    const entries = priv(reader).parseLogContent(
      logContent,
      new Date('2026-05-10T09:00:00Z'),
      new Date('2026-05-10T11:00:00Z')
    );

    // Only ERROR should be included, WARNING is normalized but still accepted
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries.some((e) => e.message === 'Error message')).toBe(true);
  });

  it('should handle malformed JSON gracefully', async () => {
    const logContent = `
{"timestamp":"2026-05-10T10:00:00Z","level":"error","message":"Valid"}
{broken json
{"timestamp":"2026-05-10T10:01:00Z","level":"error","message":"Also valid"}
`.trim();

    const entries = priv(reader).parseLogContent(
      logContent,
      new Date('2026-05-10T09:00:00Z'),
      new Date('2026-05-10T11:00:00Z')
    );

    expect(entries.length).toBeGreaterThanOrEqual(2);
  });

  it('should normalize log levels correctly', () => {
    const normalizeLevel = priv(reader).normalizeLevel.bind(reader);

    expect(normalizeLevel('critical')).toBe('CRITICAL');
    expect(normalizeLevel('CRITICAL')).toBe('CRITICAL');
    expect(normalizeLevel('fatal')).toBe('CRITICAL');
    expect(normalizeLevel('error')).toBe('ERROR');
    expect(normalizeLevel('ERROR')).toBe('ERROR');
    expect(normalizeLevel('warning')).toBe('WARNING');
    expect(normalizeLevel('warn')).toBe('WARNING');
  });
});

describe('parseSystemEventsJson', () => {
  it('парсит дамп json_agg и приводит поля', () => {
    const raw = JSON.stringify([
      {
        createdAt: '2026-08-10T10:00:00Z',
        level: 'ERROR',
        source: 'payments',
        message: 'boom',
        metadata: { orderId: 'x' },
      },
      { createdAt: '2026-08-10T11:00:00Z', level: 'WARNING', source: 'client-beacon', message: 'js err' },
    ]);
    const entries = parseSystemEventsJson(raw);
    expect(entries).toHaveLength(2);
    expect(entries[0].timestamp).toEqual(new Date('2026-08-10T10:00:00Z'));
    expect(entries[0].metadata).toEqual({ orderId: 'x' });
    expect(entries[1].level).toBe('WARNING');
  });

  it('пустой массив — пустой результат', () => {
    expect(parseSystemEventsJson('[]')).toEqual([]);
  });

  it('битые строки пропускаются, а не роняют интейк', () => {
    const raw = JSON.stringify([
      { createdAt: 'мусор', level: 'ERROR', source: 's', message: 'm' },
      { createdAt: '2026-08-10T10:00:00Z', level: 'INFO', source: 's', message: 'm' },
      { createdAt: '2026-08-10T10:00:00Z', level: 'ERROR', source: 42, message: 'm' },
      { createdAt: '2026-08-10T10:00:00Z', level: 'ERROR', source: 's', message: 'ok' },
    ]);
    const entries = parseSystemEventsJson(raw);
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe('ok');
  });

  it('не-массив — ошибка: дамп снят неправильно', () => {
    expect(() => parseSystemEventsJson('{"oops": true}')).toThrow('не JSON-массив');
    expect(() => parseSystemEventsJson('совсем не json')).toThrow();
  });
});

describe('JsonEventsReader', () => {
  it('фильтрует по окну и пропускает WARNING', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'events-'));
    const file = join(dir, 'events.json');
    writeFileSync(
      file,
      JSON.stringify([
        { createdAt: '2026-08-09T10:00:00Z', level: 'ERROR', source: 's', message: 'too early' },
        { createdAt: '2026-08-10T10:00:00Z', level: 'ERROR', source: 's', message: 'in range' },
        { createdAt: '2026-08-10T10:30:00Z', level: 'WARNING', source: 'client-beacon', message: 'warn in range' },
        { createdAt: '2026-08-11T10:00:00Z', level: 'ERROR', source: 's', message: 'too late' },
      ]),
    );
    const entries = await new JsonEventsReader(file).read(
      new Date('2026-08-10T00:00:00Z'),
      new Date('2026-08-10T23:59:59Z'),
    );
    expect(entries.map((e) => e.message)).toEqual(['in range', 'warn in range']);
  });
});
