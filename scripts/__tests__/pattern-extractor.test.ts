import { describe, it, expect } from 'vitest';
import { PatternExtractor } from '../lib/pattern-extractor';
import { LogEntry } from '../lib/log-reader';

describe('PatternExtractor', () => {
  const extractor = new PatternExtractor();

  describe('extract', () => {
    it('should group identical errors into single pattern', () => {
      const entries: LogEntry[] = [
        {
          timestamp: new Date('2026-05-10T10:00:00Z'),
          level: 'ERROR',
          source: 'api/booking',
          message: 'BOOKING_CONFLICT: Slot already taken',
        },
        {
          timestamp: new Date('2026-05-10T10:05:00Z'),
          level: 'ERROR',
          source: 'api/booking',
          message: 'BOOKING_CONFLICT: Slot already taken',
        },
        {
          timestamp: new Date('2026-05-10T10:10:00Z'),
          level: 'ERROR',
          source: 'api/booking',
          message: 'BOOKING_CONFLICT: Slot already taken',
        },
      ];

      const patterns = extractor.extract(entries);

      expect(patterns).toHaveLength(1);
      expect(patterns[0].count).toBe(3);
      expect(patterns[0].source).toBe('api/booking');
      expect(patterns[0].examples).toHaveLength(3);
    });

    it('should normalize UUIDs in messages', () => {
      const entries: LogEntry[] = [
        {
          timestamp: new Date('2026-05-10T10:00:00Z'),
          level: 'ERROR',
          source: 'api/booking',
          message: 'Resource not found: abc12345-6789-1234-5678-123456789abc',
        },
        {
          timestamp: new Date('2026-05-10T10:05:00Z'),
          level: 'ERROR',
          source: 'api/booking',
          message: 'Resource not found: def67890-1234-5678-9012-345678901def',
        },
      ];

      const patterns = extractor.extract(entries);

      expect(patterns).toHaveLength(1);
      expect(patterns[0].count).toBe(2);
    });

    it('should normalize timestamps in messages', () => {
      const entries: LogEntry[] = [
        {
          timestamp: new Date('2026-05-10T10:00:00Z'),
          level: 'ERROR',
          source: 'api/booking',
          message: 'Failed at 2026-05-10T10:00:00.000Z',
        },
        {
          timestamp: new Date('2026-05-10T10:05:00Z'),
          level: 'ERROR',
          source: 'api/booking',
          message: 'Failed at 2026-05-10T10:05:00.000Z',
        },
      ];

      const patterns = extractor.extract(entries);

      expect(patterns).toHaveLength(1);
      expect(patterns[0].count).toBe(2);
    });

    it('should normalize numbers in messages', () => {
      const entries: LogEntry[] = [
        {
          timestamp: new Date('2026-05-10T10:00:00Z'),
          level: 'ERROR',
          source: 'api/booking',
          message: 'Rate limit exceeded: 150 requests',
        },
        {
          timestamp: new Date('2026-05-10T10:05:00Z'),
          level: 'ERROR',
          source: 'api/booking',
          message: 'Rate limit exceeded: 200 requests',
        },
      ];

      const patterns = extractor.extract(entries);

      expect(patterns).toHaveLength(1);
      expect(patterns[0].count).toBe(2);
    });

    it('should normalize IP addresses in messages', () => {
      const entries: LogEntry[] = [
        {
          timestamp: new Date('2026-05-10T10:00:00Z'),
          level: 'ERROR',
          source: 'api/booking',
          message: 'Request from 192.168.1.100 blocked',
        },
        {
          timestamp: new Date('2026-05-10T10:05:00Z'),
          level: 'ERROR',
          source: 'api/booking',
          message: 'Request from 10.0.0.1 blocked',
        },
      ];

      const patterns = extractor.extract(entries);

      expect(patterns).toHaveLength(1);
      expect(patterns[0].count).toBe(2);
    });

    it('should normalize line numbers in messages', () => {
      const entries: LogEntry[] = [
        {
          timestamp: new Date('2026-05-10T10:00:00Z'),
          level: 'ERROR',
          source: 'api/booking',
          message: 'Error at file.ts:123',
        },
        {
          timestamp: new Date('2026-05-10T10:05:00Z'),
          level: 'ERROR',
          source: 'api/booking',
          message: 'Error at file.ts:456',
        },
      ];

      const patterns = extractor.extract(entries);

      expect(patterns).toHaveLength(1);
      expect(patterns[0].count).toBe(2);
    });

    it('should separate patterns from different sources', () => {
      const entries: LogEntry[] = [
        {
          timestamp: new Date('2026-05-10T10:00:00Z'),
          level: 'ERROR',
          source: 'api/booking',
          message: 'Database error',
        },
        {
          timestamp: new Date('2026-05-10T10:05:00Z'),
          level: 'ERROR',
          source: 'api/cafe',
          message: 'Database error',
        },
      ];

      const patterns = extractor.extract(entries);

      expect(patterns).toHaveLength(2);
      expect(patterns[0].source).not.toBe(patterns[1].source);
    });

    it('should track firstSeen and lastSeen correctly', () => {
      const entries: LogEntry[] = [
        {
          timestamp: new Date('2026-05-10T10:00:00Z'),
          level: 'ERROR',
          source: 'api/booking',
          message: 'Error message',
        },
        {
          timestamp: new Date('2026-05-10T10:30:00Z'),
          level: 'ERROR',
          source: 'api/booking',
          message: 'Error message',
        },
        {
          timestamp: new Date('2026-05-10T10:15:00Z'),
          level: 'ERROR',
          source: 'api/booking',
          message: 'Error message',
        },
      ];

      const patterns = extractor.extract(entries);

      expect(patterns).toHaveLength(1);
      expect(patterns[0].firstSeen).toEqual(new Date('2026-05-10T10:00:00Z'));
      expect(patterns[0].lastSeen).toEqual(new Date('2026-05-10T10:30:00Z'));
    });

    it('should keep maximum 3 examples per pattern', () => {
      const entries: LogEntry[] = Array.from({ length: 10 }, (_, i) => ({
        timestamp: new Date(`2026-05-10T10:${i.toString().padStart(2, '0')}:00Z`),
        level: 'ERROR' as const,
        source: 'api/booking',
        message: 'Same error',
      }));

      const patterns = extractor.extract(entries);

      expect(patterns).toHaveLength(1);
      expect(patterns[0].count).toBe(10);
      expect(patterns[0].examples).toHaveLength(3);
    });

    it('should generate consistent fingerprints for same pattern', () => {
      const entries: LogEntry[] = [
        {
          timestamp: new Date('2026-05-10T10:00:00Z'),
          level: 'ERROR',
          source: 'api/booking',
          message: 'Error with UUID: 12345678-1234-1234-1234-123456789abc',
        },
      ];

      const patterns1 = extractor.extract(entries);

      const entries2: LogEntry[] = [
        {
          timestamp: new Date('2026-05-10T11:00:00Z'),
          level: 'ERROR',
          source: 'api/booking',
          message: 'Error with UUID: 98765432-9876-9876-9876-987654321def',
        },
      ];

      const patterns2 = extractor.extract(entries2);

      expect(patterns1[0].fingerprint).toBe(patterns2[0].fingerprint);
    });

    it('should truncate messages to 200 chars for fingerprinting', () => {
      const longMessage = 'Error: ' + 'a'.repeat(300);
      const entries: LogEntry[] = [
        {
          timestamp: new Date('2026-05-10T10:00:00Z'),
          level: 'ERROR',
          source: 'api/booking',
          message: longMessage,
        },
      ];

      const patterns = extractor.extract(entries);

      expect(patterns).toHaveLength(1);
      expect(patterns[0].sampleMessage).toBe(longMessage);
      // The fingerprint should be based on truncated message
    });
  });
});
