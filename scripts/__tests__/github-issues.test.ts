import { describe, it, expect } from 'vitest';
import {
  HIGH_FREQ_ERROR,
  fingerprintMarker,
  issueForPattern,
  issueForSpike,
  labelsForPattern,
  spikeMarker,
} from '../lib/github-issues';
import type { ErrorPattern, WarningSpike } from '../lib/pattern-extractor';

const pattern = (over: Partial<ErrorPattern> = {}): ErrorPattern => ({
  fingerprint: 'abc123def456',
  source: 'payments',
  level: 'ERROR',
  sampleMessage: 'Payment failed: timeout',
  count: 3,
  firstSeen: new Date('2026-08-10T10:00:00Z'),
  lastSeen: new Date('2026-08-10T12:00:00Z'),
  examples: [
    { timestamp: new Date('2026-08-10T10:00:00Z'), level: 'ERROR', source: 'payments', message: 'Payment failed: timeout' },
  ],
  ...over,
});

describe('labelsForPattern', () => {
  // Мост в очередь: без prio:* + auto:ready issue невидима для воркера
  // (laneOf → untriaged), и анализатор был бы декорацией.
  it.each([
    [{ level: 'CRITICAL', count: 1 }, 'prio:P1'],
    [{ level: 'ERROR', count: HIGH_FREQ_ERROR }, 'prio:P1'],
    [{ level: 'ERROR', count: HIGH_FREQ_ERROR - 1 }, 'prio:P2'],
    [{ level: 'WARNING', count: 500 }, 'prio:P2'],
  ] as const)('%o → %s', (input, expectedPrio) => {
    const labels = labelsForPattern(input);
    expect(labels).toContain(expectedPrio);
    expect(labels).toContain('auto:ready');
    expect(labels).toContain('auto-detected');
    expect(labels).toContain('bug');
  });
});

describe('issueForPattern', () => {
  it('маркер фингерпринта — первая строка тела: по нему дедуп', () => {
    const issue = issueForPattern(pattern());
    expect(issue.body.startsWith(fingerprintMarker('abc123def456'))).toBe(true);
  });

  it('тело помечает сообщения прода как данные, а не инструкции', () => {
    const issue = issueForPattern(pattern());
    expect(issue.body).toContain('данные из прода');
    expect(issue.body).toContain('не инструкции');
  });

  it('заголовок несёт level, source и обрезанное сообщение', () => {
    const issue = issueForPattern(pattern({ sampleMessage: 'x'.repeat(200) }));
    expect(issue.title).toContain('ERROR');
    expect(issue.title).toContain('payments');
    expect(issue.title.length).toBeLessThan(120);
  });
});

describe('issueForSpike', () => {
  const spike: WarningSpike = {
    source: 'client-beacon',
    count: 120,
    baselinePerDay: 10,
    examples: [
      { timestamp: new Date('2026-08-10T10:00:00Z'), level: 'WARNING', source: 'client-beacon', message: 'TypeError: x' },
    ],
  };

  it('маркер по source — первая строка тела', () => {
    const issue = issueForSpike(spike, 24);
    expect(issue.body.startsWith(spikeMarker('client-beacon'))).toBe(true);
  });

  it('всплески — всегда P2 + auto:ready', () => {
    const issue = issueForSpike(spike, 24);
    expect(issue.labels).toContain('prio:P2');
    expect(issue.labels).toContain('auto:ready');
  });

  it('заголовок несёт масштаб: сколько против базлайна', () => {
    const issue = issueForSpike(spike, 24);
    expect(issue.title).toContain('120');
    expect(issue.title).toContain('10');
  });
});
