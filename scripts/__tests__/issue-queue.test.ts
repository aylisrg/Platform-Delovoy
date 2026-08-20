import { describe, it, expect } from 'vitest';
import {
  CODE_REVIEWER_PASS_MARKER,
  DEFAULT_CONFIG,
  GIVEUP_MARKER,
  QA_ENGINEER_PASS_MARKER,
  STALE_MARKER,
  assertClaimable,
  autoMergeSkipReason,
  claimJitterSeconds,
  classifyMergeGate,
  countAttempts,
  countBackpressurePrs,
  destructiveSqlIn,
  graceElapsed,
  isDependabotAutoMergeBranch,
  isEligible,
  isNightWindowUtc,
  isTrustedVerdictAuthor,
  isUntriaged,
  releasePrGate,
  laneOf,
  missedAutoCloseIssues,
  moduleOf,
  orderQueue,
  pickNext,
  priorityOf,
  shouldHeartbeat,
  snapshot,
  staleWipIssues,
  staleWipWithPr,
  summarizeChecks,
  untriagedIssues,
  type CheckRun,
  type HeartbeatInput,
  type PrLink,
  type QueueConfig,
  type QueueIssue,
  type SweepPr,
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

/** PR-комментарии с обоими маркерами вердиктов — «ревью прошло» для гейта (#580). */
const PASSING_VERDICTS = [`${CODE_REVIEWER_PASS_MARKER}\nВердикт: PASS.`, `${QA_ENGINEER_PASS_MARKER}\nВердикт: PASS.`];

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

  it('review — отдельная полоса: PR открыт и ждёт владельца', () => {
    expect(laneOf(['auto:review'])).toBe('review');
    // живая сессия важнее: если оба лейбла, задача всё ещё в работе
    expect(laneOf(['auto:wip', 'auto:review'])).toBe('wip');
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

describe('assertClaimable (issue #647)', () => {
  it('не бросает для auto:ready', () => {
    expect(() => assertClaimable(['auto:ready', 'prio:P2'], 445)).not.toThrow();
  });

  it('бросает с сообщением про занятый лок для auto:wip', () => {
    expect(() => assertClaimable(['auto:wip'], 445)).toThrow('#445 уже auto:wip — лок занят');
  });

  it('бросает с текущим lane для любого другого состояния', () => {
    expect(() => assertClaimable(['auto:review'], 445)).toThrow('#445 не в auto:ready (сейчас: review)');
    expect(() => assertClaimable([], 445)).toThrow('#445 не в auto:ready (сейчас: untriaged)');
  });
});

describe('claimJitterSeconds (issue #647)', () => {
  it('возвращает значение в диапазоне [0.2, 1.5) секунд', () => {
    expect(claimJitterSeconds(() => 0)).toBe(0.2);
    expect(claimJitterSeconds(() => 0.5)).toBeCloseTo(0.85, 5);
    expect(claimJitterSeconds(() => 0.999999)).toBeLessThan(1.5);
  });

  it('разные значения rand() дают разные задержки — джиттер реально разносит вызовы во времени', () => {
    expect(claimJitterSeconds(() => 0.1)).not.toBe(claimJitterSeconds(() => 0.9));
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

  // Регрессия: PR уровня hold, который владелец не посмотрел, раньше вечно висел
  // в auto:wip и намертво останавливал очередь.
  it('issue в review не держит очередь — берётся следующая', () => {
    const result = pickNext(
      [issue(1, ['prio:P0', 'auto:review'], { hasOpenPr: true }), issue(2, ['prio:P1', 'auto:ready'])],
      config(),
      1,
    );
    expect(result.issue?.number).toBe(2);
  });

  it('несколько задач в review подряд всё равно не блокируют очередь', () => {
    const result = pickNext(
      [
        issue(1, ['auto:review'], { hasOpenPr: true }),
        issue(2, ['auto:review'], { hasOpenPr: true }),
        issue(3, ['prio:P2', 'auto:ready']),
      ],
      config({ maxOpenPrs: 5 }),
      2,
    );
    expect(result.issue?.number).toBe(3);
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

describe('DEFAULT_CONFIG', () => {
  it('несёт потолок попыток — иначе неподъёмная задача крутится вечно', () => {
    expect(DEFAULT_CONFIG.maxAttempts).toBeGreaterThan(0);
  });

  it('конфиг из файла накладывается поверх дефолтов, а не заменяет их', () => {
    // Так делает loadConfig(): частичный JSON не должен обнулять недостающие поля.
    const partial = { ...DEFAULT_CONFIG, ...JSON.parse('{"enabled": false}') };
    expect(partial.enabled).toBe(false);
    expect(partial.maxAttempts).toBe(DEFAULT_CONFIG.maxAttempts);
    expect(partial.staleWipHours).toBe(DEFAULT_CONFIG.staleWipHours);
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

describe('destructiveSqlIn', () => {
  const added = (sql: string) => sql.split('\n').map((l) => `+${l}`).join('\n');

  it.each([
    ['DROP TABLE "Booking";', 'DROP TABLE'],
    ['ALTER TABLE "Booking" DROP COLUMN "note";', 'DROP COLUMN'],
    ['TRUNCATE "Booking";', 'TRUNCATE'],
    ['DELETE FROM "Booking" WHERE id = 1;', 'DELETE FROM'],
    ['ALTER TYPE "Status" RENAME TO "OldStatus";', 'ALTER TYPE'],
    ['ALTER TABLE "Booking" ALTER COLUMN "x" SET NOT NULL;', 'SET NOT NULL'],
    ['ALTER TABLE "Booking" DROP CONSTRAINT "fk";', 'DROP CONSTRAINT'],
  ])('ловит %s', (sql, expected) => {
    expect(destructiveSqlIn(added(sql))).toContain(expected);
  });

  it.each([
    'CREATE TABLE "Blackout" ("id" TEXT NOT NULL, PRIMARY KEY ("id"));',
    'ALTER TABLE "Booking" ADD COLUMN "note" TEXT;',
    'CREATE INDEX "Booking_date_idx" ON "Booking"("date");',
    'CREATE UNIQUE INDEX "u" ON "Booking"("id");',
  ])('пропускает аддитивное: %s', (sql) => {
    expect(destructiveSqlIn(added(sql))).toEqual([]);
  });

  it('регистр не важен', () => {
    expect(destructiveSqlIn(added('drop table "X";'))).toContain('DROP TABLE');
  });

  // NOT NULL в CREATE TABLE — это объявление колонки, а не ALTER существующей.
  it('NOT NULL внутри CREATE TABLE не считается деструктивным', () => {
    expect(destructiveSqlIn(added('CREATE TABLE "X" ("id" TEXT NOT NULL);'))).toEqual([]);
  });

  it('удалённые строки не считаются — важно только то, что добавили', () => {
    expect(destructiveSqlIn('-DROP TABLE "Booking";\n+CREATE INDEX "i" ON "X"("y");')).toEqual([]);
  });
});

describe('classifyMergeGate', () => {
  it('обычный код приложения мержится автоматически', () => {
    const gate = classifyMergeGate(
      ['src/modules/booking/service.ts', 'src/modules/booking/__tests__/service.test.ts'],
      config(),
      PASSING_VERDICTS,
    );
    expect(gate.tier).toBe('auto');
    expect(gate.reasons).toEqual([]);
  });

  // Решение владельца 2026-08-11: катим сами. Инфраструктура, деплой-workflow'ы и
  // схема БД больше не держат PR — защита переехала на CI, ревью-агентов,
  // blue-green и автооткат.
  it.each([
    ['prisma/schema.prisma', 'схема'],
    ['infra/nginx/delovoy-park.conf', 'nginx'],
    ['docker-compose.prod.yml', 'compose'],
    ['Dockerfile', 'dockerfile'],
    ['.github/workflows/deploy.yml', 'деплой'],
    ['.github/workflows/ops-nginx.yml', 'ops'],
    ['scripts/deploy-bluegreen.sh', 'скрипт деплоя'],
  ])('%s больше не держит PR (%s)', (file) => {
    const gate = classifyMergeGate(['src/modules/booking/service.ts', file], config(), PASSING_VERDICTS);
    expect(gate.tier).toBe('auto');
  });

  it.each([
    '.github/workflows/issue-queue.yml',
    '.github/issue-queue.json',
    // Реализация гейта — тоже рубильник. Без этого защита циклична: агент мог бы
    // ослабить правило и тем же прогоном замержить своё ослабление.
    'scripts/lib/issue-queue.ts',
    'scripts/issue-queue.ts',
    // Интейк чеканит auto:ready из внешних данных — его правила меняет человек.
    '.github/workflows/backlog-intake.yml',
  ])('автоматизация не мержит собственный рубильник %s', (file) => {
    expect(classifyMergeGate([file], config(), PASSING_VERDICTS).tier).toBe('hold');
  });

  it('тесты очереди рубильником не считаются — их правит кто угодно', () => {
    expect(classifyMergeGate(['scripts/__tests__/issue-queue.test.ts'], config(), PASSING_VERDICTS).tier).toBe('auto');
  });

  it('чужие workflow с похожим именем под правило не попадают', () => {
    expect(classifyMergeGate(['.github/workflows/issue-templates.yml'], config(), PASSING_VERDICTS).tier).toBe('auto');
  });

  // Правило ширины PR (v2, под зонтики мелочи): жёсткий hold с 8 модулей;
  // коридор 5-7 модулей открыт только компактным диффам (≤400 строк, ≤25 файлов);
  // отсутствие метрик диффа в этом коридоре — консервативный hold.
  const moduleFile = (slug: string, lines = 20) => ({
    filename: `src/modules/${slug}/service.ts`,
    additions: lines,
    deletions: 0,
  });

  it('компактный батч по 5-7 модулям проходит — типичный зонтик мелочи', () => {
    const gate = classifyMergeGate(
      ['booking', 'gazebos', 'cafe', 'rental', 'clients', 'tasks'].map((s) => moduleFile(s, 40)),
      config(),
      PASSING_VERDICTS,
    );
    expect(gate.tier).toBe('auto');
  });

  it('5-7 модулей с диффом >400 строк — hold (широкая свалка, а не батч)', () => {
    const gate = classifyMergeGate(
      ['booking', 'gazebos', 'cafe', 'rental', 'clients'].map((s) => moduleFile(s, 120)),
      config(),
      PASSING_VERDICTS,
    );
    expect(gate.tier).toBe('hold');
    expect(gate.reasons.join(' ')).toContain('scope creep');
  });

  it('5-7 модулей и >25 файлов — hold независимо от строк', () => {
    const files = Array.from({ length: 26 }, (_, i) => ({
      filename: `src/modules/${['booking', 'gazebos', 'cafe', 'rental', 'clients'][i % 5]}/f${i}.ts`,
      additions: 2,
      deletions: 0,
    }));
    expect(classifyMergeGate(files, config(), PASSING_VERDICTS).tier).toBe('hold');
  });

  it('5-7 модулей БЕЗ метрик диффа — консервативный hold (нет данных ≠ можно)', () => {
    const gate = classifyMergeGate(
      [
        'src/modules/booking/service.ts',
        'src/modules/gazebos/service.ts',
        'src/modules/cafe/service.ts',
        'src/modules/rental/service.ts',
        'src/modules/clients/service.ts',
      ],
      config(),
      PASSING_VERDICTS,
    );
    expect(gate.tier).toBe('hold');
    expect(gate.reasons.join(' ')).toContain('метрики диффа недоступны');
    expect(gate.modules).toHaveLength(5);
  });

  it('8+ модулей — hold всегда, даже компактные', () => {
    const gate = classifyMergeGate(
      ['booking', 'gazebos', 'cafe', 'rental', 'clients', 'tasks', 'users', 'analytics'].map((s) => moduleFile(s, 5)),
      config(),
      PASSING_VERDICTS,
    );
    expect(gate.tier).toBe('hold');
    expect(gate.reasons.join(' ')).toContain('scope creep');
  });

  it('4 модуля проходят как раньше — правило ширины их не трогает', () => {
    const gate = classifyMergeGate(
      [
        'src/modules/booking/service.ts',
        'src/modules/gazebos/service.ts',
        'src/modules/cafe/service.ts',
        'src/modules/rental/service.ts',
      ],
      config(),
      PASSING_VERDICTS,
    );
    expect(gate.tier).toBe('auto');
  });

  it('аддитивная миграция мержится сама', () => {
    const gate = classifyMergeGate(
      [{ filename: 'prisma/migrations/20260811_x/migration.sql', patch: '+ALTER TABLE "Booking" ADD COLUMN "note" TEXT;' }],
      config(),
      PASSING_VERDICTS,
    );
    expect(gate.tier).toBe('auto');
  });

  it('деструктивная миграция держит PR — потеря данных необратима', () => {
    const gate = classifyMergeGate(
      [
        { filename: 'src/modules/booking/service.ts' },
        { filename: 'prisma/migrations/20260811_x/migration.sql', patch: '+ALTER TABLE "Booking" DROP COLUMN "note";' },
      ],
      config(),
      PASSING_VERDICTS,
    );
    expect(gate.tier).toBe('hold');
    expect(gate.reasons.join(' ')).toContain('DROP COLUMN');
  });

  // F6 аудита: раньше «нет patch» молча значило «безопасно» — деструктивный SQL в
  // файле, слишком большом для GitHub-диффа, проскакивал бы незамеченным.
  it('миграция без доступного диффа держит PR — ручная проверка вместо угадывания', () => {
    const gate = classifyMergeGate(
      [{ filename: 'prisma/migrations/20260811_x/migration.sql' }],
      config(),
      PASSING_VERDICTS,
    );
    expect(gate.tier).toBe('hold');
    expect(gate.reasons.join(' ')).toContain('diff миграции');
    expect(gate.reasons.join(' ')).toContain('недоступен');
  });

  it('деструктивный SQL вне prisma/migrations гейт не трогает', () => {
    const gate = classifyMergeGate(
      [{ filename: 'scripts/seeds/cleanup.ts', patch: '+await prisma.$executeRaw`DROP TABLE tmp`;' }],
      config(),
      PASSING_VERDICTS,
    );
    expect(gate.tier).toBe('auto');
  });

  it('глобальный autoMerge=false держит всё', () => {
    const gate = classifyMergeGate(['src/modules/booking/service.ts'], config({ autoMerge: false }), PASSING_VERDICTS);
    expect(gate.tier).toBe('hold');
    expect(gate.reasons.join(' ')).toContain('выключен');
  });

  it('собирает все причины сразу, а не только первую', () => {
    const gate = classifyMergeGate(
      [
        { filename: '.github/issue-queue.json' },
        { filename: 'prisma/migrations/20260811_x/migration.sql', patch: '+DROP TABLE "Booking";' },
      ],
      config({ autoMerge: false }),
      PASSING_VERDICTS,
    );
    expect(gate.reasons.length).toBeGreaterThanOrEqual(3);
    const joined = gate.reasons.join(' ');
    expect(joined).toContain('выключен');
    expect(joined).toContain('рубильники');
    expect(joined).toContain('DROP TABLE');
  });

  // #580, F5 аудита: «PASS от ревью-агентов» раньше была конвенцией промпта, не
  // машинной проверкой — сессия, пропустившая шаг 5, давала PR, неотличимый для
  // подметальщика от проверенного.
  describe('маркеры вердиктов ревью-агентов (#580)', () => {
    it('без маркеров вообще — hold', () => {
      const gate = classifyMergeGate(['src/modules/booking/service.ts'], config(), []);
      expect(gate.tier).toBe('hold');
      expect(gate.reasons.join(' ')).toContain('вердиктов ревью-агентов');
    });

    it('только code-reviewer — всё ещё hold', () => {
      const gate = classifyMergeGate(
        ['src/modules/booking/service.ts'],
        config(),
        [`${CODE_REVIEWER_PASS_MARKER}\nВердикт: PASS.`],
      );
      expect(gate.tier).toBe('hold');
      expect(gate.reasons.join(' ')).toContain('вердиктов ревью-агентов');
    });

    it('только qa-engineer — всё ещё hold', () => {
      const gate = classifyMergeGate(
        ['src/modules/booking/service.ts'],
        config(),
        [`${QA_ENGINEER_PASS_MARKER}\nВердикт: PASS.`],
      );
      expect(gate.tier).toBe('hold');
      expect(gate.reasons.join(' ')).toContain('вердиктов ревью-агентов');
    });

    it('оба маркера, в любых сторонних комментариях PR — auto', () => {
      const gate = classifyMergeGate(
        ['src/modules/booking/service.ts'],
        config(),
        ['Просто комментарий владельца.', ...PASSING_VERDICTS, 'И ещё один после.'],
      );
      expect(gate.tier).toBe('auto');
      expect(gate.reasons).toEqual([]);
    });
  });
});

// Репозиторий публичный — маркер вердикта сам по себе просто строка из
// экспортируемой константы, известная кому угодно. Без проверки авторства
// любой сторонний аккаунт мог бы вставить обе строки в комментарий и получить
// `auto` без единого реального ревью. classifyMergeGate доверяет вызывающему
// коду (см. `trustedCommentBodies` в scripts/issue-queue.ts) — сама фильтрация
// авторства проверяется здесь, отдельно от гейта.
describe('isTrustedVerdictAuthor (#580)', () => {
  it('владелец репозитория — доверенный автор', () => {
    expect(isTrustedVerdictAuthor('aylisrg', 'OWNER')).toBe(true);
  });

  it('известный логин бота-автоматики — доверенный, даже с association CONTRIBUTOR', () => {
    // claude[bot] (сессии /next-issue через agent-proxy) сами приходят с
    // author_association: CONTRIBUTOR — тем же уровнем, что и у любого
    // стороннего аккаунта с одним смерженным PR в истории. Доверие тут — по
    // логину, не по association.
    expect(isTrustedVerdictAuthor('claude[bot]', 'CONTRIBUTOR')).toBe(true);
  });

  it('сторонний аккаунт с CONTRIBUTOR — НЕ доверенный (спуфинг маркера)', () => {
    expect(isTrustedVerdictAuthor('random-external-account', 'CONTRIBUTOR')).toBe(false);
  });

  it('сторонний аккаунт без истории вклада (NONE) — НЕ доверенный', () => {
    expect(isTrustedVerdictAuthor('first-time-visitor', 'NONE')).toBe(false);
  });

  it('MEMBER/COLLABORATOR без известного логина — НЕ доверенный (репозиторий сегодня без сторонних коллабораторов)', () => {
    expect(isTrustedVerdictAuthor('some-collaborator', 'COLLABORATOR')).toBe(false);
    expect(isTrustedVerdictAuthor('some-member', 'MEMBER')).toBe(false);
  });

  it('пустой логин (комментарий от удалённого/анонимизированного аккаунта) — НЕ доверенный', () => {
    expect(isTrustedVerdictAuthor('', 'NONE')).toBe(false);
  });
});

describe('summarizeChecks', () => {
  const run = (name: string, status: string, conclusion: string | null = null): CheckRun => ({
    name,
    status,
    conclusion,
  });

  it('всё прошло — зелено и завершено', () => {
    const s = summarizeChecks([run('Test', 'completed', 'success'), run('Lint', 'completed', 'success')]);
    expect(s).toMatchObject({ done: true, green: true });
    expect(s.failed).toEqual([]);
  });

  it('skipped и neutral не считаются провалом — джобы ci.yml пропускаются по условиям', () => {
    const s = summarizeChecks([
      run('Test', 'completed', 'success'),
      run('Auto-merge release-please', 'completed', 'skipped'),
      run('Advisory', 'completed', 'neutral'),
    ]);
    expect(s.green).toBe(true);
  });

  it('незавершённый чек — pending, ещё не red', () => {
    const s = summarizeChecks([run('Build', 'in_progress'), run('Test', 'completed', 'success')]);
    expect(s.done).toBe(false);
    expect(s.green).toBe(false);
    expect(s.pending.map((r) => r.name)).toEqual(['Build']);
  });

  it('падение ловится и называется поимённо', () => {
    const s = summarizeChecks([run('Test', 'completed', 'failure'), run('Lint', 'completed', 'success')]);
    expect(s.done).toBe(true);
    expect(s.green).toBe(false);
    expect(s.failed.map((r) => r.name)).toEqual(['Test']);
  });

  it.each(['failure', 'cancelled', 'timed_out', 'action_required', 'stale', null])(
    'conclusion=%s считается провалом',
    (conclusion) => {
      expect(summarizeChecks([run('X', 'completed', conclusion)]).green).toBe(false);
    },
  );

  // Регрессия: раньше пустой список считался зелёным. Сразу после push чеков
  // ещё нет, и pr-merge мержил бы непроверенный код — прямиком в прод.
  it('пустой список чеков — НЕ зелено: CI просто ещё не стартовал', () => {
    expect(summarizeChecks([])).toMatchObject({ done: false, green: false });
  });
});

describe('countBackpressurePrs', () => {
  const link = (prNumber: number, over: Partial<PrLink> = {}): PrLink => ({
    prNumber,
    queueBranch: true,
    issueLanes: [],
    ...over,
  });

  it('PR с issue в wip/ready/untriaged — давление', () => {
    expect(countBackpressurePrs([link(1, { issueLanes: ['wip'] })])).toBe(1);
    expect(countBackpressurePrs([link(1, { issueLanes: ['ready'] })])).toBe(1);
    expect(countBackpressurePrs([link(1, { issueLanes: ['untriaged'] })])).toBe(1);
  });

  // Регрессия: два припаркованных hold-PR раньше выедали maxOpenPrs=2 и намертво
  // замораживали очередь — ровно то, от чего park должен был спасать.
  it('PR-ы инбокса владельца (review/blocked/prod-apply/epic/parked) — не давление', () => {
    const links = (['review', 'blocked', 'prod-apply', 'epic', 'parked'] as const).map((lane, i) =>
      link(i + 1, { issueLanes: [lane] }),
    );
    expect(countBackpressurePrs(links)).toBe(0);
  });

  it('сирота на ветке очереди считается — консервативно', () => {
    expect(countBackpressurePrs([link(1, { issueLanes: [] })])).toBe(1);
  });

  it('чужие PR-ы (release-please, dependabot, ручные ветки) — не давление', () => {
    expect(countBackpressurePrs([link(1, { queueBranch: false, issueLanes: [] })])).toBe(0);
  });

  it('PR с двумя issues считается один раз', () => {
    expect(countBackpressurePrs([link(7, { issueLanes: ['wip'] }), link(7, { issueLanes: ['ready'] })])).toBe(1);
  });

  it('смешанные lanes: хватает одной wip, чтобы PR давил', () => {
    expect(countBackpressurePrs([link(1, { issueLanes: ['review', 'wip'] })])).toBe(1);
  });
});

describe('staleWipWithPr', () => {
  const now = new Date('2026-08-10T12:00:00Z');
  const cfg = config({ staleWipHours: 6 });

  it('wip с замершим PR протухает по updated_at PR-а', () => {
    const stale = staleWipWithPr(
      [issue(1, ['auto:wip'], { hasOpenPr: true })],
      new Map([[1, '2026-08-10T03:00:00Z']]),
      cfg,
      now,
    );
    expect(stale.map((i) => i.number)).toEqual([1]);
  });

  it('живой PR (свежий updated_at) лок не отдаёт', () => {
    const stale = staleWipWithPr(
      [issue(1, ['auto:wip'], { hasOpenPr: true })],
      new Map([[1, '2026-08-10T11:00:00Z']]),
      cfg,
      now,
    );
    expect(stale).toEqual([]);
  });

  it('wip без PR — не его случай, этим занимается staleWipIssues', () => {
    const stale = staleWipWithPr(
      [issue(1, ['auto:wip'], { hasOpenPr: false, updatedAt: '2026-08-01T00:00:00Z' })],
      new Map(),
      cfg,
      now,
    );
    expect(stale).toEqual([]);
  });

  it('review-задачи не трогает — они намеренно ждут владельца', () => {
    const stale = staleWipWithPr(
      [issue(1, ['auto:review'], { hasOpenPr: true })],
      new Map([[1, '2026-08-01T00:00:00Z']]),
      cfg,
      now,
    );
    expect(stale).toEqual([]);
  });
});

// Issue #616: GitHub иногда не закрывает issue автоматически по `Closes #N`
// смерженного PR. issue() по умолчанию даёт updatedAt = '2026-08-10T00:00:00Z' —
// mergedAt ниже намеренно на/после этой отметки, кроме теста на переоткрытие.
describe('missedAutoCloseIssues', () => {
  it('находит issue в auto:wip, чей смерженный PR должен был её закрыть', () => {
    const result = missedAutoCloseIssues(
      [issue(548, ['auto:wip'])],
      [{ number: 609, closesIssues: [548], mergedAt: '2026-08-10T01:00:00Z' }],
    );
    expect(result).toEqual([{ issue: issue(548, ['auto:wip']), prNumber: 609 }]);
  });

  it('находит issue и в auto:ready, и в auto:review', () => {
    const result = missedAutoCloseIssues(
      [issue(1, ['auto:ready']), issue(2, ['auto:review'])],
      [
        { number: 100, closesIssues: [1], mergedAt: '2026-08-10T01:00:00Z' },
        { number: 101, closesIssues: [2], mergedAt: '2026-08-10T01:00:00Z' },
      ],
    );
    expect(result.map((r) => r.issue.number).sort()).toEqual([1, 2]);
  });

  it('не трогает epic/parked/blocked — это состояния для владельца', () => {
    const result = missedAutoCloseIssues(
      [
        issue(1, ['auto:epic']),
        issue(2, ['auto:parked']),
        issue(3, ['auto:blocked']),
      ],
      [
        { number: 100, closesIssues: [1], mergedAt: '2026-08-10T01:00:00Z' },
        { number: 101, closesIssues: [2], mergedAt: '2026-08-10T01:00:00Z' },
        { number: 102, closesIssues: [3], mergedAt: '2026-08-10T01:00:00Z' },
      ],
    );
    expect(result).toEqual([]);
  });

  it('issue без смерженного PR, который её закрывает, — не трогает', () => {
    const result = missedAutoCloseIssues(
      [issue(1, ['auto:wip'])],
      [{ number: 100, closesIssues: [2], mergedAt: '2026-08-10T01:00:00Z' }],
    );
    expect(result).toEqual([]);
  });

  it('пустой список смерженных PR — не трогает ничего', () => {
    expect(missedAutoCloseIssues([issue(1, ['auto:wip'])], [])).toEqual([]);
  });

  // Регрессия на замечание code review: issue, переоткрытая владельцем ПОСЛЕ
  // мержа PR (осознанно — фикс оказался неполным), не должна закрываться
  // обратно. Reopen обновляет issue.updatedAt — этого достаточно, чтобы
  // отличить «пропуск auto-close» (issue.updatedAt <= pr.mergedAt) от
  // «issue тронута кем-то уже после мержа».
  it('не закрывает issue, тронутую (переоткрытую) уже после мержа PR-а', () => {
    const reopened = issue(548, ['auto:wip'], { updatedAt: '2026-08-11T00:00:00Z' });
    const result = missedAutoCloseIssues(
      [reopened],
      [{ number: 609, closesIssues: [548], mergedAt: '2026-08-10T01:00:00Z' }],
    );
    expect(result).toEqual([]);
  });

  it('issue.updatedAt ровно на moment мержа PR-а — всё ещё считается пропуском', () => {
    const result = missedAutoCloseIssues(
      [issue(1, ['auto:wip'], { updatedAt: '2026-08-10T01:00:00Z' })],
      [{ number: 100, closesIssues: [1], mergedAt: '2026-08-10T01:00:00Z' }],
    );
    expect(result.map((r) => r.issue.number)).toEqual([1]);
  });

  it('один PR закрывает две разные issues — обе попадают в результат', () => {
    const result = missedAutoCloseIssues(
      [issue(1, ['auto:wip']), issue(2, ['auto:ready'])],
      [{ number: 100, closesIssues: [1, 2], mergedAt: '2026-08-10T01:00:00Z' }],
    );
    expect(result.map((r) => r.issue.number).sort()).toEqual([1, 2]);
    expect(result.every((r) => r.prNumber === 100)).toBe(true);
  });
});

describe('countAttempts', () => {
  it('считает stale-маркеры', () => {
    expect(countAttempts([STALE_MARKER, 'обычный комментарий', STALE_MARKER])).toBe(2);
  });

  // Регрессия: терминальный комментарий раньше нёс тот же маркер, что и попытки,
  // и возвращённая владельцем задача мгновенно блокировалась обратно.
  it('give-up сбрасывает счётчик — возвращённая задача начинает с нуля', () => {
    expect(countAttempts([STALE_MARKER, STALE_MARKER, GIVEUP_MARKER])).toBe(0);
    expect(countAttempts([STALE_MARKER, GIVEUP_MARKER, STALE_MARKER])).toBe(1);
  });

  it('легаси-фраза старых терминальных комментариев тоже сбрасывает', () => {
    // Так выглядели give-up комментарии до разделения маркеров: STALE_MARKER + фраза.
    const legacy = `${STALE_MARKER}\n\nЗадача снята с автоочереди: 3 попытки подряд...`;
    expect(countAttempts([STALE_MARKER, STALE_MARKER, legacy])).toBe(0);
  });

  it('сам give-up попыткой не считается', () => {
    expect(countAttempts([GIVEUP_MARKER])).toBe(0);
  });
});

describe('shouldHeartbeat', () => {
  const base: HeartbeatInput = {
    enabled: true,
    readyCount: 5,
    wipCount: 0,
    lastQueuePrActivityAt: null,
    lastAlertAt: null,
    now: new Date('2026-08-10T12:00:00Z'),
    idleHours: 3,
    cooldownHours: 12,
  };

  it('очередь стоит, PR-ов не было, алертов не было → алерт', () => {
    expect(shouldHeartbeat(base).alert).toBe(true);
  });

  it('выключенная очередь — простой законный', () => {
    expect(shouldHeartbeat({ ...base, enabled: false }).alert).toBe(false);
  });

  it('пустая очередь — простой законный', () => {
    expect(shouldHeartbeat({ ...base, readyCount: 0 }).alert).toBe(false);
  });

  it('есть wip — кто-то работает, не алертим', () => {
    expect(shouldHeartbeat({ ...base, wipCount: 1 }).alert).toBe(false);
  });

  it('свежая PR-активность гасит алерт, старая — нет', () => {
    expect(shouldHeartbeat({ ...base, lastQueuePrActivityAt: '2026-08-10T10:30:00Z' }).alert).toBe(false);
    expect(shouldHeartbeat({ ...base, lastQueuePrActivityAt: '2026-08-10T05:00:00Z' }).alert).toBe(true);
  });

  it('ровно idleHours назад — ещё не простой (граница включительно)', () => {
    expect(shouldHeartbeat({ ...base, lastQueuePrActivityAt: '2026-08-10T09:00:00Z' }).alert).toBe(false);
  });

  it('кулдаун: недавний алерт не повторяется, старый — повторяется', () => {
    expect(shouldHeartbeat({ ...base, lastAlertAt: '2026-08-10T02:00:00Z' }).alert).toBe(false);
    expect(shouldHeartbeat({ ...base, lastAlertAt: '2026-08-09T22:00:00Z' }).alert).toBe(true);
  });
});

describe('isUntriaged / untriagedIssues', () => {
  it('issue без лейблов и issue с одними prio/bug — входящие для триажа', () => {
    expect(isUntriaged(issue(1, []))).toBe(true);
    expect(isUntriaged(issue(2, ['bug', 'prio:P1']))).toBe(true);
  });

  it('любой auto:* лейбл выводит из триажа', () => {
    for (const lane of ['auto:ready', 'auto:wip', 'auto:review', 'auto:blocked', 'auto:epic', 'auto:parked']) {
      expect(isUntriaged(issue(1, [lane]))).toBe(false);
    }
  });

  it('дашборд — не входящая, хотя auto:dashboard не lane', () => {
    expect(isUntriaged(issue(1, ['auto:dashboard']))).toBe(false);
  });

  it('инцидент-issues watchdog-ов не триажируются — у них свой цикл', () => {
    for (const label of ['site-down', 'notifications-down', 'ci-failure']) {
      expect(isUntriaged(issue(1, [label]))).toBe(false);
    }
  });

  it('untriagedIssues фильтрует и сортирует по номеру', () => {
    const list = untriagedIssues([
      issue(30, ['bug']),
      issue(10, []),
      issue(20, ['auto:ready']),
    ]);
    expect(list.map((i) => i.number)).toEqual([10, 30]);
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

describe('autoMergeSkipReason', () => {
  const NOW = new Date('2026-08-12T12:00:00Z');
  // По умолчанию PR давно тихий — тесты, где тишина не проверяется, о ней не думают.
  const pr = (over: Partial<SweepPr> = {}): SweepPr => ({
    prNumber: 500,
    branch: 'claude/issue-445-lockfile',
    labels: [],
    issueLanes: ['wip'],
    updatedAt: '2026-08-12T10:00:00Z',
    ...over,
  });

  it('пропускает PR ветки очереди', () => {
    expect(autoMergeSkipReason(pr(), config(), NOW)).toBeNull();
  });

  it('пропускает PR ветки агента вне очереди — по ней приходят разборы инцидентов', () => {
    // Ровно случай PR #491: ветка claude/{task}, issue инцидента уже закрыта
    // watchdog'ом, привязки к очереди нет никакой. Раньше такой PR оседал у владельца.
    expect(
      autoMergeSkipReason(pr({ branch: 'claude/delovoy-park-accessibility-9w4cyc', issueLanes: [] }), config(), NOW),
    ).toBeNull();
  });

  it('пропускает PR с чужой веткой, если он закрывает issue очереди', () => {
    // Случай PR #483: ветку сессия назвала по-своему, связь только через `Closes #482`.
    expect(autoMergeSkipReason(pr({ branch: 'hotfix/release-numbering', issueLanes: ['wip'] }), config(), NOW)).toBeNull();
  });

  it('не трогает чужие PR — release-please, dependabot, ручные ветки', () => {
    for (const branch of ['release-please--branches--main', 'dependabot/npm_and_yarn/next-15', 'feature/cafe-qr']) {
      expect(autoMergeSkipReason(pr({ branch, issueLanes: [] }), config(), NOW)).toMatch(/не PR автоматики/);
    }
  });

  it('не трогает PR, помеченный needs-owner', () => {
    expect(autoMergeSkipReason(pr({ labels: ['needs-owner'] }), config(), NOW)).toMatch(/needs-owner/);
  });

  it('ждёт тишины: свежий PR может дописывать живая сессия', () => {
    const fresh = pr({ updatedAt: '2026-08-12T11:55:00Z' }); // 5 минут назад
    expect(autoMergeSkipReason(fresh, config({ automergeQuietMinutes: 20 }), NOW)).toMatch(/жду 20 мин тишины/);
  });

  it('черновик сам по себе не причина пропустить — флаг снимет подметальщик', () => {
    // Сессии Claude Code на вебе обязаны открывать PR черновиком. Если считать
    // draft стоп-сигналом, каждый такой PR ждёт клика владельца — то есть ровно
    // того участия, ради устранения которого подметальщик и написан.
    expect(autoMergeSkipReason(pr(), config(), NOW)).toBeNull();
  });

  it('issue в auto:review не блокирует мерж — туда уезжают PR умерших сессий', () => {
    expect(autoMergeSkipReason(pr({ branch: 'x/y', issueLanes: ['review'] }), config(), NOW)).toBeNull();
  });
});

// ── Расширение HOLD_PATTERNS (ADR 2026-08-20-owner-out-of-github) ───────────

describe('HOLD_PATTERNS v2', () => {
  it.each([
    // Свипер: агент не может переписать мержащий механизм и тем же прогоном замержить.
    '.github/workflows/issue-queue-merge.yml',
    // Ребейзер форс-пушит чужие ветки под PAT с человеческой атрибуцией.
    '.github/workflows/auto-rebase.yml',
    // Контур owner-decisions — путь к мержу мимо гейта.
    'src/modules/owner-decisions/service.ts',
    'src/app/api/admin/owner-decisions/route.ts',
    'src/app/api/bot/owner-decisions/route.ts',
    'bot/handlers/owner-decisions.ts',
    // Промпт /next-issue — программа агента с правом мержа (ведёт к вердиктам #580).
    '.claude/commands/next-issue.md',
  ])('%s — рубильник, автоматика не мержит сама', (file) => {
    expect(classifyMergeGate([file], config(), PASSING_VERDICTS).tier).toBe('hold');
  });

  it.each([
    // Чистые функции зонтиков и сторожей решений о мерже не принимают.
    'scripts/lib/issue-batch.ts',
    'scripts/lib/batch-io.ts',
    'scripts/lib/queue-watch.ts',
    // Остальные командные промпты — ручка тюнинга, меняются часто (ADR: асимметрия
    // с next-issue.md осознанная).
    '.claude/commands/plan-epic.md',
    // Тест бот-хендлера — не сам хендлер.
    'bot/handlers/__tests__/owner-decisions.test.ts',
  ])('%s рубильником не считается', (file) => {
    expect(classifyMergeGate([file], config(), PASSING_VERDICTS).tier).toBe('auto');
  });
});

// ── Ночной релиз-трейн и dependabot-группы ──────────────────────────────────

describe('isNightWindowUtc', () => {
  it('окно [0,2): 00:30 внутри, 02:00 и 12:00 снаружи', () => {
    expect(isNightWindowUtc(new Date('2026-08-20T00:30:00Z'), [0, 2])).toBe(true);
    expect(isNightWindowUtc(new Date('2026-08-20T01:59:00Z'), [0, 2])).toBe(true);
    expect(isNightWindowUtc(new Date('2026-08-20T02:00:00Z'), [0, 2])).toBe(false);
    expect(isNightWindowUtc(new Date('2026-08-20T12:00:00Z'), [0, 2])).toBe(false);
  });

  it('окно через полночь [23,1)', () => {
    expect(isNightWindowUtc(new Date('2026-08-20T23:30:00Z'), [23, 1])).toBe(true);
    expect(isNightWindowUtc(new Date('2026-08-20T00:30:00Z'), [23, 1])).toBe(true);
    expect(isNightWindowUtc(new Date('2026-08-20T02:00:00Z'), [23, 1])).toBe(false);
  });
});

describe('releasePrGate', () => {
  const NIGHT = new Date('2026-08-20T00:30:00Z');
  const DAY = new Date('2026-08-20T14:00:00Z');
  const RELEASE_FILES = ['CHANGELOG.md', 'package.json', 'package-lock.json'];

  it('whitelist + ночь → мерж', () => {
    expect(releasePrGate(RELEASE_FILES, NIGHT, config()).merge).toBe(true);
  });

  it('днём релиз ждёт ночного окна — мерж release-PR это деплой без кода', () => {
    const res = releasePrGate(RELEASE_FILES, DAY, config());
    expect(res.merge).toBe(false);
    expect(res.reason).toContain('ночного окна');
  });

  it('файл вне whitelist — не release-PR, обычный путь через гейт', () => {
    const res = releasePrGate([...RELEASE_FILES, 'src/lib/db.ts'], NIGHT, config());
    expect(res.merge).toBe(false);
    expect(res.reason).toContain('вне whitelist');
  });
});

describe('isDependabotAutoMergeBranch', () => {
  it('групповые ветки minor+patch мержатся свипером', () => {
    expect(isDependabotAutoMergeBranch('dependabot/npm_and_yarn/npm-minor-patch-8f21ab90c1')).toBe(true);
    expect(isDependabotAutoMergeBranch('dependabot/github_actions/actions-all-1a2b3c')).toBe(true);
  });

  it('одиночные ветки (majors) — нет: их конвертируют в задачи очереди', () => {
    expect(isDependabotAutoMergeBranch('dependabot/npm_and_yarn/ioredis-6.0.0')).toBe(false);
    expect(isDependabotAutoMergeBranch('dependabot/github_actions/actions/setup-node-7')).toBe(false);
  });

  it('имя группы в середине сегмента не совпадает — сравнение по сегменту, не includes', () => {
    // Пакет с именем, содержащим подстроку группы, — не группа.
    expect(isDependabotAutoMergeBranch('dependabot/npm_and_yarn/some-npm-minor-patch-lib-2.0.0')).toBe(false);
    expect(isDependabotAutoMergeBranch('dependabot/npm_and_yarn/npm-minor-patch')).toBe(true);
  });

  it('не-dependabot ветка — нет, даже с похожим сегментом', () => {
    expect(isDependabotAutoMergeBranch('claude/issue-1-npm-minor-patch')).toBe(false);
  });
});

describe('graceElapsed', () => {
  const NOW = new Date('2026-08-20T12:00:00Z');

  it('окно «Отменить» ещё идёт — исполнять рано', () => {
    expect(graceElapsed('2026-08-20T11:50:00Z', NOW, 15)).toBe(false);
  });

  it('окно прошло — можно мержить', () => {
    expect(graceElapsed('2026-08-20T11:44:00Z', NOW, 15)).toBe(true);
  });
});
