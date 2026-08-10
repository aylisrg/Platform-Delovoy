import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CONFIG,
  classifyMergeGate,
  isEligible,
  laneOf,
  moduleOf,
  orderQueue,
  pickNext,
  priorityOf,
  snapshot,
  staleWipIssues,
  type QueueConfig,
  type QueueIssue,
} from '../lib/issue-queue';

function issue(number: number, labels: string[], over: Partial<QueueIssue> = {}): QueueIssue {
  return {
    number,
    title: `issue ${number}`,
    labels,
    updatedAt: '2026-08-10T00:00:00Z',
    hasOpenPr: false,
    ...over,
  };
}

const config = (over: Partial<QueueConfig> = {}): QueueConfig => ({ ...DEFAULT_CONFIG, ...over });

describe('laneOf', () => {
  it('распознаёт каждую полосу', () => {
    expect(laneOf(['auto:ready'])).toBe('ready');
    expect(laneOf(['auto:wip'])).toBe('wip');
    expect(laneOf(['auto:blocked'])).toBe('blocked');
    expect(laneOf(['auto:prod-apply'])).toBe('prod-apply');
    expect(laneOf(['auto:epic'])).toBe('epic');
    expect(laneOf(['auto:parked'])).toBe('parked');
  });

  it('issue без auto:* лейблов — untriaged, а не ready', () => {
    expect(laneOf(['bug', 'prio:P0'])).toBe('untriaged');
    expect(laneOf([])).toBe('untriaged');
  });

  it('при конфликте wip побеждает ready — иначе issue возьмут дважды', () => {
    expect(laneOf(['auto:ready', 'auto:wip'])).toBe('wip');
  });
});

describe('priorityOf', () => {
  it('читает приоритет и игнорирует остальные лейблы', () => {
    expect(priorityOf(['bug', 'prio:P1', 'auto:ready'])).toBe('P1');
    expect(priorityOf(['bug'])).toBeNull();
  });

  it('при нескольких приоритетах берёт самый высокий', () => {
    expect(priorityOf(['prio:P2', 'prio:P0'])).toBe('P0');
  });
});

describe('isEligible', () => {
  it('ready без PR — можно брать', () => {
    expect(isEligible(issue(1, ['auto:ready']))).toBe(true);
  });

  it('ready с открытым PR брать нельзя — работа уже идёт', () => {
    expect(isEligible(issue(1, ['auto:ready'], { hasOpenPr: true }))).toBe(false);
  });

  it('epic, parked, blocked и prod-apply не берутся', () => {
    for (const lane of ['auto:epic', 'auto:parked', 'auto:blocked', 'auto:prod-apply']) {
      expect(isEligible(issue(1, [lane]))).toBe(false);
    }
  });
});

describe('orderQueue', () => {
  it('сортирует по приоритету, затем по номеру', () => {
    const ordered = orderQueue(
      [
        issue(500, ['prio:P2']),
        issue(100, ['prio:P1']),
        issue(300, ['prio:P0']),
        issue(200, ['prio:P0']),
      ],
      config(),
    );
    expect(ordered.map((i) => i.number)).toEqual([200, 300, 100, 500]);
  });

  it('issues без приоритета уходят в хвост', () => {
    const ordered = orderQueue([issue(1, []), issue(999, ['prio:P2'])], config());
    expect(ordered.map((i) => i.number)).toEqual([999, 1]);
  });

  it('pinned встают в голову в заданном порядке, обгоняя приоритет', () => {
    const ordered = orderQueue(
      [issue(100, ['prio:P0']), issue(445, ['prio:P0']), issue(428, ['prio:P0'])],
      config({ pinned: [445, 428] }),
    );
    expect(ordered.map((i) => i.number)).toEqual([445, 428, 100]);
  });

  it('не мутирует входной массив', () => {
    const input = [issue(2, ['prio:P2']), issue(1, ['prio:P0'])];
    orderQueue(input, config());
    expect(input.map((i) => i.number)).toEqual([2, 1]);
  });
});

describe('pickNext', () => {
  it('берёт первую по порядку', () => {
    const result = pickNext([issue(9, ['prio:P1', 'auto:ready']), issue(5, ['prio:P0', 'auto:ready'])], config(), 0);
    expect(result.issue?.number).toBe(5);
    expect(result.reason).toBeNull();
  });

  it('выключенная очередь ничего не берёт', () => {
    const result = pickNext([issue(1, ['prio:P0', 'auto:ready'])], config({ enabled: false }), 0);
    expect(result.issue).toBeNull();
    expect(result.reason).toContain('выключена');
  });

  it('останавливается на backpressure при достижении лимита PR', () => {
    const result = pickNext([issue(1, ['prio:P0', 'auto:ready'])], config({ maxOpenPrs: 2 }), 2);
    expect(result.issue).toBeNull();
    expect(result.reason).toContain('backpressure');
  });

  it('не берёт вторую issue, пока первая в работе', () => {
    const result = pickNext(
      [issue(1, ['auto:wip']), issue(2, ['prio:P0', 'auto:ready'])],
      config(),
      0,
    );
    expect(result.issue).toBeNull();
    expect(result.reason).toContain('#1');
  });

  it('объясняет пустую очередь, а не молчит', () => {
    const result = pickNext([issue(1, ['auto:blocked'])], config(), 0);
    expect(result.issue).toBeNull();
    expect(result.reason).toContain('auto:ready');
  });
});

describe('staleWipIssues', () => {
  const now = new Date('2026-08-10T12:00:00Z');

  it('снимает лок после staleWipHours молчания', () => {
    const stale = staleWipIssues(
      [issue(1, ['auto:wip'], { updatedAt: '2026-08-10T05:00:00Z' })],
      config({ staleWipHours: 6 }),
      now,
    );
    expect(stale.map((i) => i.number)).toEqual([1]);
  });

  it('не трогает свежий лок', () => {
    const stale = staleWipIssues(
      [issue(1, ['auto:wip'], { updatedAt: '2026-08-10T11:00:00Z' })],
      config({ staleWipHours: 6 }),
      now,
    );
    expect(stale).toEqual([]);
  });

  it('не трогает лок с открытым PR, даже старый — работа реально идёт', () => {
    const stale = staleWipIssues(
      [issue(1, ['auto:wip'], { updatedAt: '2026-08-01T00:00:00Z', hasOpenPr: true })],
      config({ staleWipHours: 6 }),
      now,
    );
    expect(stale).toEqual([]);
  });
});

describe('moduleOf', () => {
  it('вытаскивает модуль из путей modules / api / admin', () => {
    expect(moduleOf('src/modules/booking/service.ts')).toBe('booking');
    expect(moduleOf('src/app/api/gazebos/route.ts')).toBe('gazebos');
    expect(moduleOf('src/app/(admin)/admin/cafe/page.tsx')).toBe('cafe');
  });

  it('возвращает null для файлов вне модулей', () => {
    expect(moduleOf('src/lib/db.ts')).toBeNull();
    expect(moduleOf('README.md')).toBeNull();
  });
});

describe('classifyMergeGate', () => {
  it('обычный код приложения мержится автоматически', () => {
    const gate = classifyMergeGate(
      ['src/modules/booking/service.ts', 'src/modules/booking/__tests__/service.test.ts'],
      config(),
    );
    expect(gate.tier).toBe('auto');
    expect(gate.reasons).toEqual([]);
  });

  it.each([
    ['prisma/migrations/20260810_x/migration.sql', 'миграция'],
    ['prisma/schema.prisma', 'схема'],
    ['infra/nginx/delovoy-park.conf', 'nginx'],
    ['docker-compose.prod.yml', 'compose'],
    ['Dockerfile', 'dockerfile'],
    ['.github/workflows/deploy.yml', 'деплой'],
    ['.github/workflows/ops-nginx.yml', 'ops'],
    ['scripts/deploy-bluegreen.sh', 'скрипт деплоя'],
  ])('%s держит PR на hold (%s)', (file) => {
    const gate = classifyMergeGate(['src/modules/booking/service.ts', file], config());
    expect(gate.tier).toBe('hold');
    expect(gate.reasons.join(' ')).toContain('прод-инфру');
  });

  it('автоматизация не мержит сама себя', () => {
    expect(classifyMergeGate(['.github/workflows/issue-queue.yml'], config()).tier).toBe('hold');
    expect(classifyMergeGate(['.github/issue-queue.json'], config()).tier).toBe('hold');
  });

  it('5+ модулей — scope creep по правилу CLAUDE.md #5', () => {
    const gate = classifyMergeGate(
      [
        'src/modules/booking/service.ts',
        'src/modules/gazebos/service.ts',
        'src/modules/cafe/service.ts',
        'src/modules/rental/service.ts',
        'src/modules/clients/service.ts',
      ],
      config(),
    );
    expect(gate.tier).toBe('hold');
    expect(gate.reasons.join(' ')).toContain('scope creep');
    expect(gate.modules).toHaveLength(5);
  });

  it('4 модуля ещё проходят', () => {
    const gate = classifyMergeGate(
      [
        'src/modules/booking/service.ts',
        'src/modules/gazebos/service.ts',
        'src/modules/cafe/service.ts',
        'src/modules/rental/service.ts',
      ],
      config(),
    );
    expect(gate.tier).toBe('auto');
  });

  it('глобальный autoMerge=false держит всё', () => {
    const gate = classifyMergeGate(['src/modules/booking/service.ts'], config({ autoMerge: false }));
    expect(gate.tier).toBe('hold');
    expect(gate.reasons.join(' ')).toContain('выключен');
  });

  it('собирает все причины сразу, а не только первую', () => {
    const gate = classifyMergeGate(
      ['prisma/schema.prisma', 'infra/nginx/x.conf'],
      config({ autoMerge: false }),
    );
    expect(gate.reasons.length).toBeGreaterThanOrEqual(3);
  });
});

describe('snapshot', () => {
  it('раскладывает бэклог по полосам и считает следующую', () => {
    const snap = snapshot(
      [
        issue(1, ['prio:P0', 'auto:ready']),
        issue(2, ['prio:P1', 'auto:ready']),
        issue(3, ['auto:blocked']),
        issue(4, ['auto:epic']),
        issue(5, ['auto:wip']),
      ],
      config(),
      0,
    );
    expect(snap.byLane.ready.map((i) => i.number)).toEqual([1, 2]);
    expect(snap.byLane.blocked).toHaveLength(1);
    expect(snap.byLane.epic).toHaveLength(1);
    // #5 занята — воркер не берёт ничего нового
    expect(snap.next.issue).toBeNull();
    expect(snap.ordered.map((i) => i.number)).toEqual([1, 2]);
  });
});
