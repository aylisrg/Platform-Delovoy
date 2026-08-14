import { createHash } from 'crypto';
import { LogEntry } from './log-reader';

export interface ErrorPattern {
  fingerprint: string;
  source: string;
  /** Максимальная серьёзность среди событий паттерна — от неё зависит prio issue. */
  level: LogEntry['level'];
  sampleMessage: string;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  examples: LogEntry[];
}

const LEVEL_RANK: Record<LogEntry['level'], number> = { WARNING: 0, ERROR: 1, CRITICAL: 2 };

export class PatternExtractor {
  extract(entries: LogEntry[]): ErrorPattern[] {
    const patternMap = new Map<string, ErrorPattern>();

    for (const entry of entries) {
      const fingerprint = this.generateFingerprint(entry);

      if (!patternMap.has(fingerprint)) {
        patternMap.set(fingerprint, {
          fingerprint,
          source: entry.source,
          level: entry.level,
          sampleMessage: entry.message,
          count: 0,
          firstSeen: entry.timestamp,
          lastSeen: entry.timestamp,
          examples: [],
        });
      }

      const pattern = patternMap.get(fingerprint)!;
      pattern.count++;
      if (LEVEL_RANK[entry.level] > LEVEL_RANK[pattern.level]) pattern.level = entry.level;
      pattern.lastSeen = entry.timestamp > pattern.lastSeen ? entry.timestamp : pattern.lastSeen;
      pattern.firstSeen = entry.timestamp < pattern.firstSeen ? entry.timestamp : pattern.firstSeen;

      // Keep max 3 examples
      if (pattern.examples.length < 3) {
        pattern.examples.push(entry);
      }
    }

    return Array.from(patternMap.values());
  }

  private generateFingerprint(entry: LogEntry): string {
    // server-error (issue #576) уже несёт стабильный отпечаток от самого
    // Next.js (onRequestError digest) — он надёжнее текстовой нормализации
    // сообщения, которая для стеков ошибок съедает почти весь текст под
    // <PATH>/<N> и может слить разные исключения в один паттерн.
    if (entry.source === 'server-error' && typeof entry.metadata?.digest === 'string') {
      const input = `${entry.source}:${entry.metadata.digest}`;
      return createHash('sha256').update(input).digest('hex').substring(0, 12);
    }
    const normalized = this.normalizeMessage(entry.message);
    const input = `${entry.source}:${normalized}`;
    return createHash('sha256').update(input).digest('hex').substring(0, 12);
  }

  private normalizeMessage(message: string): string {
    let normalized = message;

    // Remove UUIDs (8-4-4-4-12 format)
    normalized = normalized.replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      '<UUID>'
    );

    // Remove timestamps (ISO format and common variations)
    normalized = normalized.replace(
      /\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(\.\d{3})?Z?/g,
      '<TIMESTAMP>'
    );

    // Remove IP addresses
    normalized = normalized.replace(
      /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
      '<IP>'
    );

    // Remove line numbers (e.g., :123, line 456)
    normalized = normalized.replace(/:\d+/g, ':<N>');
    normalized = normalized.replace(/line \d+/gi, 'line <N>');

    // Replace standalone numbers with <N>
    normalized = normalized.replace(/\b\d+\b/g, '<N>');

    // Remove file paths (common patterns)
    normalized = normalized.replace(/\/[\w\-./]+/g, '<PATH>');

    // Truncate to first 200 chars
    normalized = normalized.substring(0, 200);

    // Normalize whitespace
    normalized = normalized.replace(/\s+/g, ' ').trim();

    return normalized;
  }
}

// ── Всплески WARNING ────────────────────────────────────────────────────────
//
// client-beacon и rate-limit не фингерпринтуются: их сообщения слишком
// разнородны (у каждого браузера свой текст ошибки), а поодиночке они
// безобидны. Сигнал — объём: заметно больше событий, чем в спокойную неделю.

export interface WarningSpike {
  source: string;
  /** Событий в текущем окне. */
  count: number;
  /** Средний темп базлайна, событий в сутки. */
  baselinePerDay: number;
  examples: LogEntry[];
}

export interface SpikeOptions {
  /** Длина текущего окна, часов. */
  hours: number;
  /** Длина базлайн-окна, дней. */
  baselineDays: number;
  /** Минимум событий в окне — ниже него всплеск не объявляется вовсе. */
  minCount: number;
  /** Во сколько раз темп должен превысить базлайн. */
  factor: number;
}

export const DEFAULT_SPIKE_OPTIONS: SpikeOptions = {
  hours: 24,
  baselineDays: 7,
  // Суточный аналог живого порога watchdog-а (15 событий за 30 мин у
  // beacon-divergence в site-watchdog.yml): редкий фон не шумит, устойчивый
  // всплеск виден.
  minCount: 50,
  factor: 3,
};

export function detectWarningSpikes(
  currentWarnings: LogEntry[],
  baselineWarnings: LogEntry[],
  opts: SpikeOptions = DEFAULT_SPIKE_OPTIONS,
): WarningSpike[] {
  const bySource = (entries: LogEntry[]) => {
    const map = new Map<string, LogEntry[]>();
    for (const e of entries) {
      if (e.level !== 'WARNING') continue;
      const list = map.get(e.source) ?? [];
      list.push(e);
      map.set(e.source, list);
    }
    return map;
  };

  const current = bySource(currentWarnings);
  const baseline = bySource(baselineWarnings);
  const spikes: WarningSpike[] = [];

  for (const [source, entries] of current) {
    const count = entries.length;
    if (count < opts.minCount) continue;

    const baselineCount = baseline.get(source)?.length ?? 0;
    const baselinePerHour = baselineCount / (opts.baselineDays * 24);
    const currentPerHour = count / opts.hours;
    // Нулевой базлайн не делает всплеском любую мелочь: minCount уже отсёк фон,
    // а ε не даёт делить на ноль.
    const threshold = opts.factor * Math.max(baselinePerHour, 1e-9);
    if (currentPerHour < threshold) continue;

    spikes.push({
      source,
      count,
      baselinePerDay: Math.round((baselineCount / opts.baselineDays) * 10) / 10,
      examples: entries.slice(0, 3),
    });
  }

  return spikes.sort((a, b) => b.count - a.count);
}
