import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import {
  listPipelineRuns,
  getPipelineRun,
  aggregateRuns,
} from "../service";
import type { PipelineMetricEvent, PipelineRun } from "../types";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readdir: vi.fn(),
      readFile: vi.fn(),
    },
  };
});

const mockReaddir = fs.readdir as unknown as ReturnType<typeof vi.fn>;
const mockReadFile = fs.readFile as unknown as ReturnType<typeof vi.fn>;

const makeEvent = (
  overrides: Partial<PipelineMetricEvent> = {}
): PipelineMetricEvent => ({
  ts: "2026-04-16T10:00:00Z",
  run_id: "2026-04-16-test",
  task: "Sample task",
  stage: "po",
  iteration: 0,
  model: "sonnet",
  status: "completed",
  duration_sec: 60,
  verdict: "n/a",
  exit_code: 0,
  ...overrides,
});

const toJsonl = (events: PipelineMetricEvent[]) =>
  events.map((e) => JSON.stringify(e)).join("\n");

describe("pipeline-metrics/service", () => {
  beforeEach(() => {
    mockReaddir.mockReset();
    mockReadFile.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("listPipelineRuns", () => {
    it("returns empty list when metrics dir does not exist", async () => {
      const err = new Error("ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      mockReaddir.mockRejectedValueOnce(err);

      const runs = await listPipelineRuns();
      expect(runs).toEqual([]);
    });

    it("filters out non-metrics files", async () => {
      mockReaddir.mockResolvedValueOnce([
        "2026-04-16-a.log",
        "2026-04-16-a.metrics.jsonl",
        "2026-04-15-b.state.json",
      ]);
      mockReadFile.mockResolvedValueOnce(
        toJsonl([makeEvent({ run_id: "2026-04-16-a" })])
      );

      const runs = await listPipelineRuns();
      expect(runs).toHaveLength(1);
      expect(runs[0]?.runId).toBe("2026-04-16-a");
    });

    it("parses multi-stage run and derives PASS verdict from final QA", async () => {
      mockReaddir.mockResolvedValueOnce(["2026-04-16-feat.metrics.jsonl"]);
      mockReadFile.mockResolvedValueOnce(
        toJsonl([
          makeEvent({ stage: "po", ts: "2026-04-16T10:00:00Z", duration_sec: 30 }),
          makeEvent({ stage: "architect", ts: "2026-04-16T10:05:00Z", duration_sec: 60 }),
          makeEvent({ stage: "developer", ts: "2026-04-16T10:10:00Z", duration_sec: 120 }),
          makeEvent({
            stage: "reviewer",
            ts: "2026-04-16T10:15:00Z",
            verdict: "PASS",
            duration_sec: 45,
          }),
          makeEvent({
            stage: "qa",
            ts: "2026-04-16T10:20:00Z",
            verdict: "PASS",
            duration_sec: 50,
          }),
        ])
      );

      const [run] = await listPipelineRuns();
      expect(run).toBeDefined();
      expect(run?.status).toBe("success");
      expect(run?.finalVerdict).toBe("PASS");
      expect(run?.totalDurationSec).toBe(30 + 60 + 120 + 45 + 50);
      expect(run?.qaIterations).toBe(1);
      expect(run?.reviewerIterations).toBe(1);
    });

    it("marks run as failed when any stage failed", async () => {
      mockReaddir.mockResolvedValueOnce(["run.metrics.jsonl"]);
      mockReadFile.mockResolvedValueOnce(
        toJsonl([
          makeEvent({ stage: "po" }),
          makeEvent({ stage: "architect", status: "failed", exit_code: 1 }),
        ])
      );

      const [run] = await listPipelineRuns();
      expect(run?.status).toBe("failed");
    });

    it("counts iterations correctly when QA runs multiple times", async () => {
      mockReaddir.mockResolvedValueOnce(["run.metrics.jsonl"]);
      mockReadFile.mockResolvedValueOnce(
        toJsonl([
          makeEvent({ stage: "developer", iteration: 0 }),
          makeEvent({ stage: "qa", iteration: 0, verdict: "FAIL" }),
          makeEvent({ stage: "developer", iteration: 1 }),
          makeEvent({ stage: "qa", iteration: 1, verdict: "PASS" }),
        ])
      );

      const [run] = await listPipelineRuns();
      expect(run?.qaIterations).toBe(2);
      expect(run?.finalVerdict).toBe("PASS");
    });

    it("ignores malformed JSONL lines", async () => {
      mockReaddir.mockResolvedValueOnce(["run.metrics.jsonl"]);
      mockReadFile.mockResolvedValueOnce(
        [JSON.stringify(makeEvent()), "not a json", ""].join("\n")
      );
      const [run] = await listPipelineRuns();
      expect(run?.stages).toHaveLength(1);
    });
  });

  describe("getPipelineRun", () => {
    it("returns null when file does not exist", async () => {
      const err = new Error("ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      mockReadFile.mockRejectedValueOnce(err);

      const result = await getPipelineRun("missing");
      expect(result).toBeNull();
    });

    it("returns parsed run by id", async () => {
      mockReadFile.mockResolvedValueOnce(
        toJsonl([makeEvent({ run_id: "2026-04-16-xyz" })])
      );
      const result = await getPipelineRun("2026-04-16-xyz");
      expect(result?.runId).toBe("2026-04-16-xyz");
    });
  });

  describe("aggregateRuns", () => {
    const successRun: PipelineRun = {
      runId: "r1",
      task: "t1",
      startedAt: "2026-04-16T10:00:00Z",
      finishedAt: "2026-04-16T10:30:00Z",
      totalDurationSec: 300,
      stages: [
        makeEvent({ stage: "po", duration_sec: 30 }),
        makeEvent({ stage: "qa", duration_sec: 50, verdict: "PASS" }),
      ],
      status: "success",
      qaIterations: 1,
      reviewerIterations: 1,
      finalVerdict: "PASS",
    };

    const failedRun: PipelineRun = {
      ...successRun,
      runId: "r2",
      status: "failed",
      totalDurationSec: 120,
      qaIterations: 3,
      finalVerdict: "FAIL",
      stages: [makeEvent({ stage: "qa", status: "failed", exit_code: 1 })],
    };

    it("returns zeros for empty input", () => {
      const agg = aggregateRuns([]);
      expect(agg.totalRuns).toBe(0);
      expect(agg.successRate).toBe(0);
    });

    it("computes success rate and avg duration", () => {
      const agg = aggregateRuns([successRun, failedRun]);
      expect(agg.totalRuns).toBe(2);
      expect(agg.successRate).toBe(0.5);
      expect(agg.avgDurationSec).toBe((300 + 120) / 2);
      expect(agg.avgQaIterations).toBe((1 + 3) / 2);
    });

    it("computes failure rate per stage", () => {
      const agg = aggregateRuns([successRun, failedRun]);
      expect(agg.byStage.qa.runs).toBe(2);
      expect(agg.byStage.qa.failureRate).toBe(0.5);
    });
  });
});
