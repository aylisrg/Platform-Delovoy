import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ERROR_BUDGET_OPTIONS,
  classifyErrorBudget,
  errorBudgetIssue,
  errorBudgetMarker,
} from '../error-budget';

describe('classifyErrorBudget', () => {
  it('здоровый деплой (после не больше, чем до) — none', () => {
    expect(classifyErrorBudget(10, 8)).toEqual({ action: 'none', ratio: 0.8 });
  });

  it('after ниже minAbsolute — none, даже если ratio формально огромен', () => {
    // before=1, after=4: ratio=4 (>= alertFactor 3), но after < minAbsolute(5)
    expect(classifyErrorBudget(1, 4)).toEqual({ action: 'none', ratio: 4 });
  });

  it('ровно на пороге alertFactor (×3) — alert', () => {
    expect(classifyErrorBudget(5, 15)).toEqual({ action: 'alert', ratio: 3 });
  });

  it('чуть ниже порога alertFactor — none', () => {
    const result = classifyErrorBudget(10, 29); // ratio 2.9
    expect(result.action).toBe('none');
    expect(result.ratio).toBeCloseTo(2.9);
  });

  it('ровно на пороге rollbackFactor (×5) — rollback', () => {
    expect(classifyErrorBudget(5, 25)).toEqual({ action: 'rollback', ratio: 5 });
  });

  it('между alertFactor и rollbackFactor — alert, не rollback', () => {
    const result = classifyErrorBudget(10, 45); // ratio 4.5
    expect(result.action).toBe('alert');
  });

  it('сильно выше rollbackFactor — rollback', () => {
    expect(classifyErrorBudget(5, 100).action).toBe('rollback');
  });

  it('малые числа: before=1, after=6 — ratio 6 (rollback), но after проходит minAbsolute', () => {
    expect(classifyErrorBudget(1, 6)).toEqual({ action: 'rollback', ratio: 6 });
  });

  describe('baseline 0 (ratio не определён)', () => {
    it('before=0, after ниже minAbsolute — none', () => {
      expect(classifyErrorBudget(0, 4)).toEqual({ action: 'none', ratio: null });
    });

    it('before=0, after между minAbsolute и rollbackMinAbsoluteOnZeroBaseline — alert, не rollback', () => {
      // Тихий прод (0 ошибок до) с несколькими новыми ошибками после — не повод
      // для необратимого авто-отката без референса, но и не игнорировать.
      expect(classifyErrorBudget(0, 5)).toEqual({ action: 'alert', ratio: null });
      expect(classifyErrorBudget(0, 24)).toEqual({ action: 'alert', ratio: null });
    });

    it('before=0, after >= rollbackMinAbsoluteOnZeroBaseline — rollback', () => {
      expect(classifyErrorBudget(0, 25)).toEqual({ action: 'rollback', ratio: null });
      expect(classifyErrorBudget(0, 500)).toEqual({ action: 'rollback', ratio: null });
    });

    it('before=0, after=0 — none', () => {
      expect(classifyErrorBudget(0, 0)).toEqual({ action: 'none', ratio: null });
    });
  });

  it('точные пороки настраиваются через opts', () => {
    const opts = { alertFactor: 2, rollbackFactor: 4, minAbsolute: 1, rollbackMinAbsoluteOnZeroBaseline: 10 };
    expect(classifyErrorBudget(5, 10, opts)).toEqual({ action: 'alert', ratio: 2 });
    expect(classifyErrorBudget(5, 20, opts)).toEqual({ action: 'rollback', ratio: 4 });
    expect(classifyErrorBudget(0, 9, opts)).toEqual({ action: 'alert', ratio: null });
    expect(classifyErrorBudget(0, 10, opts)).toEqual({ action: 'rollback', ratio: null });
  });

  it('DEFAULT_ERROR_BUDGET_OPTIONS соответствует issue #578: ×3 алерт, ×5 откат, abs>=5', () => {
    expect(DEFAULT_ERROR_BUDGET_OPTIONS).toEqual({
      alertFactor: 3,
      rollbackFactor: 5,
      minAbsolute: 5,
      rollbackMinAbsoluteOnZeroBaseline: 25,
    });
  });
});

describe('errorBudgetMarker / errorBudgetIssue — дедуп по SHA', () => {
  it('маркер стабилен для одного и того же SHA', () => {
    expect(errorBudgetMarker('abc123')).toBe(errorBudgetMarker('abc123'));
  });

  it('разные SHA — разные маркеры', () => {
    expect(errorBudgetMarker('abc123')).not.toBe(errorBudgetMarker('def456'));
  });

  it('тело issue начинается с маркера — дедуп через includes() найдёт его', () => {
    const issue = errorBudgetIssue({
      action: 'alert',
      before: 5,
      after: 20,
      ratio: 4,
      deploySha: 'abcdef1234567890',
      previousSha: 'fedcba0987654321',
      commits: [{ sha: 'abcdef1234567890', message: 'fix: something', url: 'https://github.com/x/y/commit/abc' }],
      runUrl: 'https://github.com/x/y/actions/runs/1',
    });
    expect(issue.body.startsWith(errorBudgetMarker('abcdef1234567890'))).toBe(true);
    expect(issue.labels).toContain('prio:P0');
    expect(issue.labels).toContain('deploy-error-budget');
    // auto:ready — детерминированный детектор, видим очереди сразу, без триажа.
    expect(issue.labels).toContain('auto:ready');
    expect(issue.body).not.toContain('Авто-откат запущен');
  });

  it('rollback issue упоминает предыдущий SHA и авто-откат', () => {
    const issue = errorBudgetIssue({
      action: 'rollback',
      before: 5,
      after: 30,
      ratio: 6,
      deploySha: 'abcdef1234567890',
      previousSha: 'fedcba0987654321',
      commits: [],
      runUrl: 'https://github.com/x/y/actions/runs/1',
    });
    expect(issue.body).toContain('Авто-откат запущен');
    expect(issue.body).toContain('fedcba0');
    expect(issue.labels).toContain('deploy-rollback');
  });

  it('пустой список коммитов — не падает, показывает заглушку', () => {
    const issue = errorBudgetIssue({
      action: 'alert',
      before: 0,
      after: 10,
      ratio: null,
      deploySha: 'abc',
      previousSha: null,
      commits: [],
      runUrl: 'https://x',
    });
    expect(issue.body).toContain('недоступен');
  });

  it('rollback БЕЗ previousSha — issue НЕ должен заявлять, что откат запущен (QA #578, БАГ-1)', () => {
    // Реальный кейс: самый первый деплой после появления этого механизма —
    // DEPLOYED_SHA_PREVIOUS ещё не задан. workflow (deploy-error-budget.yml)
    // в этом случае dispatch НЕ делает (гейт previous_sha != '') — issue не
    // должен утверждать обратное.
    const issue = errorBudgetIssue({
      action: 'rollback',
      before: 5,
      after: 30,
      ratio: 6,
      deploySha: 'cafe000512345678',
      previousSha: null,
      commits: [],
      runUrl: 'https://github.com/x/y/actions/runs/1',
    });
    expect(issue.body).not.toContain('Авто-откат запущен');
    expect(issue.body).not.toContain('`?`');
    expect(issue.body).toContain('Авто-откат пропущен');
  });

  it('сообщение коммита с markdown-спецсимволами экранируется в ссылке', () => {
    const issue = errorBudgetIssue({
      action: 'alert',
      before: 5,
      after: 20,
      ratio: 4,
      deploySha: 'abc',
      previousSha: 'def',
      commits: [
        {
          sha: 'aaaaaaa1234567',
          message: 'fix: `](evil)[click me](https://evil.example.com',
          url: 'https://github.com/x/y/commit/aaaaaaa',
        },
      ],
      runUrl: 'https://x',
    });
    // Экранированы `, [, ] — этого достаточно, чтобы markdown-ссылка не
    // закрылась раньше времени (круглые скобки внутри текста ссылки безопасны
    // сами по себе, экранировать их не требуется).
    expect(issue.body).toContain('\\`\\](evil)\\[click me\\]');
    expect(issue.body).not.toContain('[click me](https://evil.example.com)');
  });

  it('бэкслеш перед спецсимволом не открывает обход экранирования (QA #578, повторная проверка)', () => {
    // \] без экранирования самого \ — CommonMark читает как "экранированный
    // обратный слэш" + отдельный неэкранированный ], закрывающий ссылку раньше.
    const issue = errorBudgetIssue({
      action: 'alert',
      before: 5,
      after: 20,
      ratio: 4,
      deploySha: 'abc',
      previousSha: 'def',
      commits: [
        {
          sha: 'aaaaaaa1234567',
          message: 'fix: \\](evil)[hijack](https://evil.example.com',
          url: 'https://github.com/x/y/commit/aaaaaaa',
        },
      ],
      runUrl: 'https://x',
    });
    // \ экранирован первым: \\ остаётся литералом, ] после него — тоже экранирован.
    expect(issue.body).toContain('\\\\\\](evil)\\[hijack\\]');
    expect(issue.body).not.toContain('[hijack](https://evil.example.com)');
  });
});
