import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ERROR_BUDGET_OPTIONS,
  classifyErrorBudget,
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
