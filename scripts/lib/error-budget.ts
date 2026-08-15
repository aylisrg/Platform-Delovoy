/**
 * Post-deploy error-budget — чистая логика (issue #578).
 *
 * Честный canary на одном VPS невозможен — эквивалент: сравнить окно
 * ERROR/CRITICAL SystemEvent + client-beacon WARNING за 15 минут ПОСЛЕ
 * деплоя с тем же окном НЕПОСРЕДСТВЕННО ДО него. Порог по образцу
 * detectWarningSpikes из pattern-extractor.ts (фактор + защита от
 * нулевого/крошечного baseline), но с двумя уровнями реакции вместо одного:
 * ×3 — алерт + issue (не флапать на лёгких отклонениях), ×5 — то же плюс
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

export interface ErrorBudgetIssueInput {
  action: 'alert' | 'rollback';
  before: number;
  after: number;
  ratio: number | null;
  deploySha: string;
  previousSha: string | null;
  commits: Array<{ sha: string; message: string; url: string }>;
  runUrl: string;
}

/** Первая строка тела issue — дедуп повторных срабатываний на тот же деплой. */
export function errorBudgetMarker(deploySha: string): string {
  return `<!-- error-budget:${deploySha} -->`;
}

/**
 * Экранирует символы, ломающие markdown-ссылку `[текст](url)` — сообщение
 * коммита не наш текст. Бэкслеш экранируется ПЕРВЫМ: иначе бэкслеш перед
 * `[`/`]`/backtick в исходном сообщении даёт `\\]` — CommonMark читает это
 * как «экранированный обратный слэш» + отдельный неэкранированный `]`,
 * закрывающий ссылку раньше времени (QA issue #578, повторная проверка).
 */
function escapeMarkdownLinkText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/[[\]`]/g, '\\$&');
}

export function errorBudgetIssue(i: ErrorBudgetIssueInput): { title: string; body: string; labels: string[] } {
  const ratioText = i.ratio === null ? `${i.after} событий (было 0)` : `×${i.ratio.toFixed(1)}`;
  const commitsList =
    i.commits.length > 0
      ? i.commits
          .map((c) => `- \`${c.sha.slice(0, 7)}\` [${escapeMarkdownLinkText(c.message.split('\n')[0].slice(0, 100))}](${c.url})`)
          .join('\n')
      : '_список коммитов недоступен (нет предыдущего успешного деплоя или сравнение не удалось)_';
  // Зеркалим Telegram-шаг (deploy-error-budget.yml): реальный dispatch идёт
  // только когда previous_sha непуст (workflow это же и гейтит) — issue не
  // должен заявлять "откат запущен", когда откатывать было не на что.
  const rollbackLine =
    i.action === 'rollback'
      ? i.previousSha
        ? `\n\n🔴 **Авто-откат запущен** — деплой \`${i.deploySha.slice(0, 7)}\` откатывается на предыдущий успешный \`${i.previousSha.slice(0, 7)}\`.`
        : '\n\n⚠️ **Авто-откат пропущен** — предыдущий успешный SHA не найден, нужна ручная проверка.'
      : '';

  return {
    title: `📉 Error budget: рост ошибок после деплоя ${i.deploySha.slice(0, 7)} (${ratioText})`,
    // auto:ready — по образцу labelsForPattern/issueForSpike (github-issues.ts):
    // это детерминированный детектор, а не "непонятно что делать" — issue сразу
    // видима очереди /next-issue, а не ждёт до ~2ч триажа.
    labels: [
      'prio:P0',
      'auto-detected',
      'auto:ready',
      i.action === 'rollback' ? 'deploy-rollback' : 'deploy-error-budget',
    ],
    body: `${errorBudgetMarker(i.deploySha)}

## Рост ошибок в первые 15 минут после деплоя

**Deploy SHA:** \`${i.deploySha}\`
**До деплоя (15 мин):** ${i.before} событий (ERROR/CRITICAL + client-beacon WARNING)
**После деплоя (15 мин):** ${i.after} событий
**Отношение:** ${ratioText}${rollbackLine}

### Коммиты этого деплоя

${commitsList}

### Ссылки

- [Run с проверкой error-budget](${i.runUrl})

---
*Создано автоматически: workflow \`deploy-error-budget.yml\`.*`,
  };
}
