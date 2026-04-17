import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  PipelineAggregate,
  PipelineMetricEvent,
  PipelineRun,
  PipelineStage,
  PipelineVerdict,
} from "./types";

const METRICS_DIR = path.join(process.cwd(), "docs", "pipeline-runs");

export class PipelineMetricsError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = "PipelineMetricsError";
  }
}

async function readMetricsFile(
  filePath: string
): Promise<PipelineMetricEvent[]> {
  const raw = await fs.readFile(filePath, "utf-8");
  const lines = raw.split("\n").filter(Boolean);
  const events: PipelineMetricEvent[] = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line) as PipelineMetricEvent);
    } catch {
      // ignore malformed lines rather than failing the whole read
    }
  }
  return events;
}

function deriveVerdict(events: PipelineMetricEvent[]): PipelineVerdict {
  const qa = [...events].reverse().find((e) => e.stage === "qa");
  if (qa && qa.verdict !== "n/a") return qa.verdict;
  const reviewer = [...events].reverse().find((e) => e.stage === "reviewer");
  if (reviewer && reviewer.verdict !== "n/a") return reviewer.verdict;
  return "n/a";
}

function toRun(runId: string, events: PipelineMetricEvent[]): PipelineRun {
  const sorted = [...events].sort((a, b) => a.ts.localeCompare(b.ts));
  const startedAt = sorted[0]?.ts ?? "";
  const finishedAt = sorted[sorted.length - 1]?.ts ?? "";
  const totalDurationSec = sorted.reduce((sum, e) => sum + e.duration_sec, 0);
  const task = sorted[0]?.task ?? "";

  const qaIterations = sorted.filter((e) => e.stage === "qa").length;
  const reviewerIterations = sorted.filter((e) => e.stage === "reviewer").length;

  const anyFailed = sorted.some((e) => e.status === "failed");
  const finalVerdict = deriveVerdict(sorted);
  const status: PipelineRun["status"] = anyFailed
    ? "failed"
    : finalVerdict === "PASS"
      ? "success"
      : "failed";

  return {
    runId,
    task,
    startedAt,
    finishedAt,
    totalDurationSec,
    stages: sorted,
    status,
    qaIterations,
    reviewerIterations,
    finalVerdict,
  };
}

export async function listPipelineRuns(limit = 50): Promise<PipelineRun[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(METRICS_DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
  const metricsFiles = entries
    .filter((name) => name.endsWith(".metrics.jsonl"))
    .sort((a, b) => b.localeCompare(a))
    .slice(0, limit);

  const runs: PipelineRun[] = [];
  for (const file of metricsFiles) {
    const runId = file.replace(/\.metrics\.jsonl$/, "");
    const filePath = path.join(METRICS_DIR, file);
    const events = await readMetricsFile(filePath);
    if (events.length === 0) continue;
    runs.push(toRun(runId, events));
  }
  return runs;
}

export async function getPipelineRun(
  runId: string
): Promise<PipelineRun | null> {
  const filePath = path.join(METRICS_DIR, `${runId}.metrics.jsonl`);
  try {
    const events = await readMetricsFile(filePath);
    if (events.length === 0) return null;
    return toRun(runId, events);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export function aggregateRuns(runs: PipelineRun[]): PipelineAggregate {
  const totalRuns = runs.length;
  if (totalRuns === 0) {
    return {
      totalRuns: 0,
      successRate: 0,
      avgDurationSec: 0,
      avgQaIterations: 0,
      avgReviewerIterations: 0,
      byStage: {
        po: { runs: 0, avgDurationSec: 0, failureRate: 0 },
        architect: { runs: 0, avgDurationSec: 0, failureRate: 0 },
        developer: { runs: 0, avgDurationSec: 0, failureRate: 0 },
        reviewer: { runs: 0, avgDurationSec: 0, failureRate: 0 },
        qa: { runs: 0, avgDurationSec: 0, failureRate: 0 },
        analytics: { runs: 0, avgDurationSec: 0, failureRate: 0 },
      },
    };
  }

  const successful = runs.filter((r) => r.status === "success").length;
  const avgDurationSec =
    runs.reduce((s, r) => s + r.totalDurationSec, 0) / totalRuns;
  const avgQaIterations =
    runs.reduce((s, r) => s + r.qaIterations, 0) / totalRuns;
  const avgReviewerIterations =
    runs.reduce((s, r) => s + r.reviewerIterations, 0) / totalRuns;

  const stages: PipelineStage[] = [
    "po",
    "architect",
    "developer",
    "reviewer",
    "qa",
    "analytics",
  ];
  const byStage = {} as PipelineAggregate["byStage"];
  for (const stage of stages) {
    const events = runs.flatMap((r) => r.stages.filter((s) => s.stage === stage));
    const stageRuns = events.length;
    const avgStageDuration = stageRuns
      ? events.reduce((s, e) => s + e.duration_sec, 0) / stageRuns
      : 0;
    const failures = events.filter((e) => e.status === "failed").length;
    byStage[stage] = {
      runs: stageRuns,
      avgDurationSec: avgStageDuration,
      failureRate: stageRuns ? failures / stageRuns : 0,
    };
  }

  return {
    totalRuns,
    successRate: successful / totalRuns,
    avgDurationSec,
    avgQaIterations,
    avgReviewerIterations,
    byStage,
  };
}
