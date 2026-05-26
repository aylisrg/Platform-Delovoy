import { createHash } from 'crypto';
import { LogEntry } from './log-reader';

export interface ErrorPattern {
  fingerprint: string;
  source: string;
  sampleMessage: string;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  examples: LogEntry[];
}

export class PatternExtractor {
  extract(entries: LogEntry[]): ErrorPattern[] {
    const patternMap = new Map<string, ErrorPattern>();

    for (const entry of entries) {
      const fingerprint = this.generateFingerprint(entry.source, entry.message);

      if (!patternMap.has(fingerprint)) {
        patternMap.set(fingerprint, {
          fingerprint,
          source: entry.source,
          sampleMessage: entry.message,
          count: 0,
          firstSeen: entry.timestamp,
          lastSeen: entry.timestamp,
          examples: [],
        });
      }

      const pattern = patternMap.get(fingerprint)!;
      pattern.count++;
      pattern.lastSeen = entry.timestamp > pattern.lastSeen ? entry.timestamp : pattern.lastSeen;
      pattern.firstSeen = entry.timestamp < pattern.firstSeen ? entry.timestamp : pattern.firstSeen;

      // Keep max 3 examples
      if (pattern.examples.length < 3) {
        pattern.examples.push(entry);
      }
    }

    return Array.from(patternMap.values());
  }

  private generateFingerprint(source: string, message: string): string {
    const normalized = this.normalizeMessage(message);
    const input = `${source}:${normalized}`;
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
