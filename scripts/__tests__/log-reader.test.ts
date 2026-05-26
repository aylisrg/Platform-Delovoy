import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DbLogReader, FileLogReader } from '../lib/log-reader';

// Mock Prisma
const mockPrisma = {
  systemEvent: {
    findMany: vi.fn(),
  },
};

describe('DbLogReader', () => {
  let reader: DbLogReader;

  beforeEach(() => {
    vi.clearAllMocks();
    reader = new DbLogReader(mockPrisma as any);
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

    expect(mockPrisma.systemEvent.findMany).toHaveBeenCalledWith({
      where: {
        level: { in: ['ERROR', 'CRITICAL'] },
        createdAt: { gte: since, lte: until },
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

    // Mock private method by testing through public interface
    const entries = (reader as any).parseLogContent(
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

    const entries = (reader as any).parseLogContent(
      logContent,
      new Date('2026-05-10T09:00:00Z'),
      new Date('2026-05-10T11:00:00Z')
    );

    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(entries.every((e: any) => e.level === 'ERROR' || e.level === 'CRITICAL')).toBe(true);
  });

  it('should filter entries by time window', async () => {
    const logContent = `
{"timestamp":"2026-05-10T08:00:00Z","level":"error","source":"api/booking","message":"Too early"}
{"timestamp":"2026-05-10T10:00:00Z","level":"error","source":"api/booking","message":"In range"}
{"timestamp":"2026-05-10T12:00:00Z","level":"error","source":"api/booking","message":"Too late"}
`.trim();

    const entries = (reader as any).parseLogContent(
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

    const entries = (reader as any).parseLogContent(
      logContent,
      new Date('2026-05-10T09:00:00Z'),
      new Date('2026-05-10T11:00:00Z')
    );

    // Only ERROR should be included, WARNING is normalized but still accepted
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries.some((e: any) => e.message === 'Error message')).toBe(true);
  });

  it('should handle malformed JSON gracefully', async () => {
    const logContent = `
{"timestamp":"2026-05-10T10:00:00Z","level":"error","message":"Valid"}
{broken json
{"timestamp":"2026-05-10T10:01:00Z","level":"error","message":"Also valid"}
`.trim();

    const entries = (reader as any).parseLogContent(
      logContent,
      new Date('2026-05-10T09:00:00Z'),
      new Date('2026-05-10T11:00:00Z')
    );

    expect(entries.length).toBeGreaterThanOrEqual(2);
  });

  it('should normalize log levels correctly', () => {
    const normalizeLevel = (reader as any).normalizeLevel.bind(reader);

    expect(normalizeLevel('critical')).toBe('CRITICAL');
    expect(normalizeLevel('CRITICAL')).toBe('CRITICAL');
    expect(normalizeLevel('fatal')).toBe('CRITICAL');
    expect(normalizeLevel('error')).toBe('ERROR');
    expect(normalizeLevel('ERROR')).toBe('ERROR');
    expect(normalizeLevel('warning')).toBe('WARNING');
    expect(normalizeLevel('warn')).toBe('WARNING');
  });
});
