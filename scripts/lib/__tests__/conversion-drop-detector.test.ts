import { describe, expect, it } from 'vitest';
import {
  baselineAverage,
  conversionDropIssue,
  conversionDropMarker,
  detectConversionDrop,
  type DailyConversion,
} from '../conversion-drop-detector';

function day(date: string, reaches: number, visits: number): DailyConversion {
  return { date, reaches, visits, conversion: visits > 0 ? reaches / visits : 0 };
}

describe('baselineAverage', () => {
  it('ignores zero-visit days', () => {
    const res = baselineAverage([day('2026-10-01', 0, 0), day('2026-10-02', 10, 100)]);
    expect(res.days).toBe(1);
    expect(res.avg).toBeCloseTo(0.1);
  });
});

describe('detectConversionDrop', () => {
  it('returns null when no primaryGoalId (AC-4.4)', () => {
    const today = day('2026-10-15', 1, 100);
    const base = [day('2026-10-08', 10, 100)];
    expect(detectConversionDrop(null, today, base)).toBeNull();
  });

  it('returns null when expected volume is noise', () => {
    // 10% baseline × 5 visits = 0.5 expected reaches < 3
    const today = day('2026-10-15', 0, 5);
    const base = Array.from({ length: 7 }, (_, i) => day(`2026-10-0${i + 1}`, 10, 100));
    expect(detectConversionDrop(42, today, base)).toBeNull();
  });

  it('detects a total collapse to zero reaches', () => {
    const today = day('2026-10-15', 0, 200);
    const base = Array.from({ length: 7 }, (_, i) => day(`2026-10-0${i + 1}`, 20, 100));
    const drop = detectConversionDrop(42, today, base);
    expect(drop).not.toBeNull();
    expect(drop!.factor).toBeGreaterThanOrEqual(2);
    expect(drop!.today.reaches).toBe(0);
  });

  it('detects ≥2× drop with enough volume', () => {
    const today = day('2026-10-15', 5, 200); // 2.5%
    const base = Array.from({ length: 7 }, (_, i) => day(`2026-10-0${i + 1}`, 20, 100)); // 20%
    const drop = detectConversionDrop(42, today, base);
    expect(drop).not.toBeNull();
    expect(drop!.factor).toBeGreaterThanOrEqual(2);
    expect(drop!.goalId).toBe(42);
  });

  it('no drop when conversion similar', () => {
    const today = day('2026-10-15', 18, 100);
    const base = Array.from({ length: 7 }, (_, i) => day(`2026-10-0${i + 1}`, 20, 100));
    expect(detectConversionDrop(42, today, base)).toBeNull();
  });

  it('requires min baseline days', () => {
    const today = day('2026-10-15', 1, 100);
    const base = [day('2026-10-14', 20, 100)]; // only 1 day
    expect(detectConversionDrop(42, today, base)).toBeNull();
  });
});

describe('issue generation', () => {
  it('includes goal marker without the date and labels', () => {
    const drop = detectConversionDrop(
      7,
      day('2026-10-15', 4, 200),
      Array.from({ length: 5 }, (_, i) => day(`2026-10-0${i + 1}`, 20, 100)),
    )!;
    const issue = conversionDropIssue(drop);
    expect(issue.labels).toContain('auto:ready');
    expect(issue.body).toContain(conversionDropMarker(7));
    expect(issue.body).not.toContain('conversion-drop:7:2026-10-15');
    expect(issue.body).toContain('2026-10-15');
    expect(issue.title).toContain('7');
  });
});
