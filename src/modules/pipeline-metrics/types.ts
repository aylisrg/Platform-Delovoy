export type PipelineStageStatus = "completed" | "failed";
export type PipelineVerdict = "PASS" | "NEEDS_CHANGES" | "FAIL" | "n/a";
export type PipelineStage =
  | "po"
  | "architect"
  | "developer"
  | "reviewer"
  | "qa"
  | "analytics";

export type PipelineMetricEvent = {
  ts: string;
  run_id: string;
  task: string;
  stage: PipelineStage;
  iteration: number;
  model: string;
  status: PipelineStageStatus;
  duration_sec: number;
  verdict: PipelineVerdict;
  exit_code: number;
};

export type PipelineRun = {
  runId: string;
  task: string;
  startedAt: string;
  finishedAt: string;
  totalDurationSec: number;
  stages: PipelineMetricEvent[];
  status: "success" | "failed" | "in_progress";
  qaIterations: number;
  reviewerIterations: number;
  finalVerdict: PipelineVerdict;
};

export type PipelineAggregate = {
  totalRuns: number;
  successRate: number;
  avgDurationSec: number;
  avgQaIterations: number;
  avgReviewerIterations: number;
  byStage: Record<
    PipelineStage,
    { runs: number; avgDurationSec: number; failureRate: number }
  >;
};

/**
 * Телеметрия прогонов `/next-issue` (issue #582, Friction F7 аудита).
 * Отдельная модель от PipelineMetricEvent/PipelineRun намеренно: pipeline.sh
 * пишет один JSONL-файл НА ПРОГОН (по стейджам с итерациями/моделью/verdict),
 * а `/next-issue` — одну строку в ОБЩИЙ файл на каждую завершённую задачу
 * (см. `docs/pipeline-runs/next-issue.jsonl`, шаг 7 `.claude/commands/next-issue.md`).
 * Имя намеренно без суффикса `.metrics.jsonl` — иначе коллизия с glob'ом
 * `listPipelineRuns()` для per-run файлов pipeline.sh (issue #582 QA).
 *
 * outcome:
 *   merged   — pr-merge выполнен сессией напрямую
 *   parked   — гейт/CI не пропустили в auto-merge, PR ждёт подметальщика/владельца
 *   released — задача вернулась в очередь без PR (scope creep, не успел)
 *   blocked  — зарезервировано на будущее (сейчас `/next-issue` не порождает
 *              этот исход сама — auto:blocked ставится триажем/другими
 *              механизмами вне цикла claim→PR); оставлено в типе для полноты
 *              словаря лейблов очереди.
 */
export type NextIssueOutcome = "merged" | "parked" | "blocked" | "released";

export type NextIssueMetricEvent = {
  ts: string;
  issue: number;
  branch: string;
  outcome: NextIssueOutcome;
  ci_fix_rounds: number;
  review_rounds: number;
  duration_min: number;
};

export type NextIssueAggregate = {
  totalRuns: number;
  outcomeCounts: Record<NextIssueOutcome, number>;
  avgCiFixRounds: number;
  avgReviewRounds: number;
  medianDurationMin: number;
};
