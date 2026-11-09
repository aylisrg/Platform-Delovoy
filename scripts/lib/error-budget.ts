/**
 * Post-deploy error-budget — чистая логика (issue #578).
 *
 * Честный canary на одном VPS невозможен — эквивалент: сравнить окно
 * ERROR/CRITICAL SystemEvent + client-beacon WARNING за 15 минут ПОСЛЕ
 * деплоя с тем же окном НЕПОСРЕДСТВЕННО ДО него. Порог — фактор роста с
 * защитой от нулевого/крошечного baseline и двумя уровнями реакции:
 * ×3 — алерт (не флапать на лёгких отклонениях), ×5 — алерт плюс
 * авто-откат на предыдущий успешный деплой.
 */

export type ErrorBudgetAction = 'none' | 'alert' | 'rollback';

export interface ErrorBudgetOptions {
  /** after/before >= этого — алерт + issue. */
  alertFactor: number;
  /** after/before >= этого — плюс авто-откат. */
  rollbackFactor: number;
  /** Меньше событий "после" — не действуем вовсе, даже при формально бесконечном росте с нуля. */
  minAbsolute: number;
  /**
   * before=0 — ratio математически не определён. Не трактуем это как
   * "бесконечный рост → сразу откат": прод с нулевым фоном ошибок — обычное
   * дело в тихие часы, а откат — самое необратимое из действий здесь. При
   * нулевом baseline: minAbsolute..rollbackMinAbsoluteOnZeroBaseline-1 —
   * только алерт; rollbackMinAbsoluteOnZeroBaseline и выше — уже откат
   * (абсолютное число само по себе достаточно тревожно, вне зависимости
   * от того, что baseline было 0).
   */
  rollbackMinAbsoluteOnZeroBaseline: number;
}

export const DEFAULT_ERROR_BUDGET_OPTIONS: ErrorBudgetOptions = {
  alertFactor: 3,
  rollbackFactor: 5,
  minAbsolute: 5,
  rollbackMinAbsoluteOnZeroBaseline: 25,
};

export interface ErrorBudgetDecision {
  action: ErrorBudgetAction;
  /** null, когда before=0 (ratio не определён — решение принято по абсолюту). */
  ratio: number | null;
}

export function classifyErrorBudget(
  before: number,
  after: number,
  opts: ErrorBudgetOptions = DEFAULT_ERROR_BUDGET_OPTIONS,
): ErrorBudgetDecision {
  if (after < opts.minAbsolute) {
    return { action: 'none', ratio: before > 0 ? after / before : null };
  }

  if (before === 0) {
    const action: ErrorBudgetAction = after >= opts.rollbackMinAbsoluteOnZeroBaseline ? 'rollback' : 'alert';
    return { action, ratio: null };
  }

  const ratio = after / before;
  if (ratio >= opts.rollbackFactor) return { action: 'rollback', ratio };
  if (ratio >= opts.alertFactor) return { action: 'alert', ratio };
  return { action: 'none', ratio };
}
