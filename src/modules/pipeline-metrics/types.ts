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
