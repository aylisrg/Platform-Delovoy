import { describe, it, expect, vi, beforeEach } from 'vitest';

const ghApiMock = vi.fn();
vi.mock('../gh-api', () => ({
  REPO: 'o/r',
  ghApi: (...args: unknown[]) => ghApiMock(...args),
}));

import { batchAdd, listOpenBatches, resetBatchIoCache } from '../batch-io';
import { renderBatchBody, renderBatchItemComment } from '../issue-batch';

/** Минимальный «GitHub»: листинг отдаёт то, что в `listed`; POST создаёт/комментирует. */
function fakeGithub(opts: { listed: { number: number; area: string; labels?: string[] }[]; nextNumber: number }) {
  const comments = new Map<number, string[]>();
  let next = opts.nextNumber;
  ghApiMock.mockImplementation((path: string, method = 'GET', body?: { body?: string }) => {
    if (method === 'GET' && path.startsWith('/repos/o/r/issues?')) {
      return opts.listed.map((i) => ({
        number: i.number,
        title: 't',
        body: renderBatchBody(i.area),
        labels: (i.labels ?? ['batch', 'prio:P2', 'auto:ready']).map((name) => ({ name })),
        html_url: `https://github.com/o/r/issues/${i.number}`,
      }));
    }
    if (method === 'GET' && /\/issues\/\d+\/comments/.test(path)) {
      const n = Number(/issues\/(\d+)\//.exec(path)![1]);
      return (comments.get(n) ?? []).map((b) => ({ body: b }));
    }
    if (method === 'POST' && path === '/repos/o/r/issues') {
      const number = next++;
      return { number, html_url: `https://github.com/o/r/issues/${number}` };
    }
    if (method === 'POST' && /\/issues\/\d+\/comments/.test(path)) {
      const n = Number(/issues\/(\d+)\//.exec(path)![1]);
      comments.set(n, [...(comments.get(n) ?? []), body?.body ?? '']);
      return { id: 1 };
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
  return { comments };
}

beforeEach(() => {
  ghApiMock.mockReset();
  resetBatchIoCache();
});

describe('batchAdd — гонка листинга GitHub (зонтик #720)', () => {
  it('два batch-add одной области подряд при отстающем листинге → один зонтик, второй пункт дописан в него', () => {
    // Листинг ВСЕГДА пустой — GitHub «ещё не видит» только что созданную issue.
    const gh = fakeGithub({ listed: [], nextNumber: 900 });

    const first = batchAdd({ area: 'infra', key: 'a', title: 'A', maxItems: 8 });
    const second = batchAdd({ area: 'infra', key: 'b', title: 'B', maxItems: 8 });

    expect(first).toMatchObject({ issue: 900, created: true });
    expect(second).toMatchObject({ issue: 900, created: false, deduped: false });
    expect(gh.comments.get(900)).toHaveLength(2);
    expect(ghApiMock.mock.calls.filter(([p, m]) => m === 'POST' && p === '/repos/o/r/issues')).toHaveLength(1);
  });

  it('дедуп ключа видит пункт, дописанный этим же процессом, даже если комментарии ещё не отдаются', () => {
    fakeGithub({ listed: [{ number: 800, area: 'infra' }], nextNumber: 900 });
    // Комментарии от GitHub не приходят вообще (map пустой на чтение) — эмулируем лаг.
    ghApiMock.mockImplementation((path: string, method = 'GET') => {
      if (method === 'GET' && path.startsWith('/repos/o/r/issues?')) {
        return [{ number: 800, title: 't', body: renderBatchBody('infra'), labels: [{ name: 'batch' }, { name: 'auto:ready' }], html_url: 'u' }];
      }
      if (method === 'GET') return [];
      return { id: 1, number: 901, html_url: 'u' };
    });

    expect(batchAdd({ area: 'infra', key: 'same', title: 'X', maxItems: 8 })).toMatchObject({ issue: 800, deduped: false });
    expect(batchAdd({ area: 'infra', key: 'same', title: 'X', maxItems: 8 })).toMatchObject({ issue: 800, deduped: true });
  });

  it('другая область не подхватывает чужой свежесозданный зонтик', () => {
    fakeGithub({ listed: [], nextNumber: 900 });
    expect(batchAdd({ area: 'infra', key: 'a', title: 'A', maxItems: 8 })).toMatchObject({ issue: 900, created: true });
    expect(batchAdd({ area: 'docs', key: 'a', title: 'A', maxItems: 8 })).toMatchObject({ issue: 901, created: true });
  });

  it('листинг догнал — кэш не дублирует зонтик', () => {
    fakeGithub({ listed: [], nextNumber: 900 });
    batchAdd({ area: 'infra', key: 'a', title: 'A', maxItems: 8 });
    fakeGithub({ listed: [{ number: 900, area: 'infra' }], nextNumber: 901 });
    expect(listOpenBatches().map((b) => b.number)).toEqual([900]);
  });

  it('потолок пунктов учитывает дописанное в этом процессе — переполненный зонтик не растёт дальше', () => {
    const gh = fakeGithub({ listed: [{ number: 800, area: 'infra' }], nextNumber: 900 });
    gh.comments.set(800, [renderBatchItemComment('k1', 'one')]);
    expect(batchAdd({ area: 'infra', key: 'k2', title: 'two', maxItems: 2 })).toMatchObject({ issue: 800, created: false });
    // Эмулируем лаг: GitHub отдаёт только старый пункт k1, про k2 «не знает».
    // Кэш процесса помнит k2 → зонтик полон → третий пункт уходит в новый.
    ghApiMock.mockImplementation((path: string, method = 'GET') => {
      if (method === 'GET' && path.startsWith('/repos/o/r/issues?')) {
        return [{ number: 800, title: 't', body: renderBatchBody('infra'), labels: [{ name: 'batch' }, { name: 'auto:ready' }], html_url: 'u' }];
      }
      if (method === 'GET') return [{ body: renderBatchItemComment('k1', 'one') }];
      if (method === 'POST' && path === '/repos/o/r/issues') return { number: 900, html_url: 'u900' };
      return { id: 1 };
    });
    expect(batchAdd({ area: 'infra', key: 'k3', title: 'three', maxItems: 2 })).toMatchObject({ issue: 900, created: true });
  });
});
