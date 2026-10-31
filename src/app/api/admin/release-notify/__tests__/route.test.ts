import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AnnounceReleaseResult } from "@/modules/notifications/release-notify";

vi.mock("@/modules/notifications/release-notify", async () => {
  const { createHash } = await import("node:crypto");
  const normalizeManualReleaseNotes = (notes: string) => notes.normalize("NFC").replace(/\r\n?/g, "\n")
    .split("\n").map(line => line.trim()).filter(Boolean).join("\n");
  return {
    announceRelease: vi.fn(), normalizeManualReleaseNotes,
    manualReleaseId: (notes: string) => `manual:${createHash("sha256").update(normalizeManualReleaseNotes(notes)).digest("hex")}`,
  };
});

vi.mock("@/lib/api-response", () => ({
  apiResponse: vi.fn((data) => ({ status: 200, async json() { return { success: true, data }; } })),
  apiError: vi.fn((code, message, status = 400) => ({ status, async json() { return { success: false, error: { code, message } }; } })),
}));

import { POST } from "../route";
import { announceRelease, manualReleaseId } from "@/modules/notifications/release-notify";
const mockAnnounce = vi.mocked(announceRelease);
const VALID_SECRET = "test-secret-abc";
const body = { secret: VALID_SECRET, version: "1.2.0", commitSha: "deadbeef", releaseNotes: "- New feature", deployedAt: "2026-10-31T10:00:00.000Z" };
const queueResult: AnnounceReleaseResult = { status: "queued", reason: "queued", queued: 3, deferred: 1, skipped: 0, failed: 0, previouslyQueued: 0, retryable: false };
function request(value: unknown) { return new Request("http://localhost/api/admin/release-notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }); }

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("RELEASE_NOTIFY_SECRET", VALID_SECRET);
  mockAnnounce.mockResolvedValue(queueResult);
});

describe("release announcement endpoint (AC-RELEASE-4)", () => {
  it("rejects wrong secrets without invoking the service", async () => {
    expect((await POST(request({ ...body, secret: "wrong" }))).status).toBe(401);
    expect(mockAnnounce).not.toHaveBeenCalled();
  });
  it("fails closed when the server secret is absent", async () => {
    vi.stubEnv("RELEASE_NOTIFY_SECRET", "");
    expect((await POST(request(body))).status).toBe(503);
    expect(mockAnnounce).not.toHaveBeenCalled();
  });
  it("returns queue acceptance and deferred counts, never a delivered flag", async () => {
    const response = await POST(request(body));
    expect(await response.json()).toEqual({ success: true, data: { ...queueResult, announced: true } });
    expect(mockAnnounce).toHaveBeenCalledWith({ version: "1.2.0", commitSha: "deadbeef", releaseNotes: "- New feature", deployedAt: body.deployedAt });
  });
  it("accepts a bounded content-matched curated identity", async () => {
    const updateId = manualReleaseId(body.releaseNotes);
    expect((await POST(request({ ...body, updateId }))).status).toBe(200);
    expect(mockAnnounce).toHaveBeenCalledWith(expect.objectContaining({ updateId }));
  });
  it.each([
    { version: "manual:collision" }, { version: "v".repeat(81) }, { commitSha: "invalid!" },
    { updateId: "manual:short" }, { updateId: "manual:" + "a".repeat(65) },
    { updateId: "manual:" + "a".repeat(64) }, { releaseNotes: "x".repeat(12001) }, { deployedAt: "not-a-date" },
    { releaseNotes: " \n ", updateId: manualReleaseId(" \n ") },
  ])("rejects invalid input before service call: %j", async (override) => {
    expect((await POST(request({ ...body, ...override }))).status).toBe(400);
    expect(mockAnnounce).not.toHaveBeenCalled();
  });
  it("rejects missing required fields", async () => {
    expect((await POST(request({ secret: VALID_SECRET }))).status).toBe(400);
  });
  it("uses legacy defaults when curated identity and notes are omitted", async () => {
    const { releaseNotes: _notes, deployedAt: _date, ...withoutNotes } = body;
    await POST(request(withoutNotes));
    expect(mockAnnounce).toHaveBeenCalledWith(expect.objectContaining({ releaseNotes: "" }));
    expect(mockAnnounce.mock.calls[0][0]).not.toHaveProperty("updateId");
  });
  it.each(["already-announced", "no-recipients", "suppressed", "in-progress"] as const)("reports %s as a skip, not a new announcement", async reason => {
    const result: AnnounceReleaseResult = { ...queueResult, status: "skipped", reason, queued: 0, deferred: 0 };
    mockAnnounce.mockResolvedValue(result);
    expect(await (await POST(request(body))).json()).toEqual({ success: true, data: { ...result, announced: false, skippedReason: reason } });
  });
  it("preserves partial queue evidence on an uncertain failure", async () => {
    const result: AnnounceReleaseResult = { ...queueResult, status: "error", reason: "enqueue-failed", queued: 1, deferred: 0, failed: 1 };
    mockAnnounce.mockResolvedValue(result);
    expect(await (await POST(request(body))).json()).toEqual({ success: true, data: { ...result, announced: true } });
  });
  it("does not expose internal exceptions", async () => {
    mockAnnounce.mockRejectedValue(new Error("sensitive internal connection detail"));
    const response = await POST(request(body));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("sensitive");
  });
});
