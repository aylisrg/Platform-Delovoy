import { describe, it, expect, vi, beforeEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("@/lib/db", () => ({
  prisma: {
    releaseAnnouncement: {
      create: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
    outgoingNotification: { findMany: vi.fn() },
    notificationEventPreference: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    notificationPreference: {
      upsert: vi.fn(),
    },
    userNotificationChannel: {
      upsert: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    critical: vi.fn(),
  },
}));

vi.mock("../dispatch/dispatcher", () => ({
  dispatch: vi.fn(),
}));

const mockResolveStaffRouting = vi.fn();
vi.mock("../audience", () => ({
  resolveStaffRouting: (...args: unknown[]) => mockResolveStaffRouting(...args),
}));

/** Release audience as the shared resolver returns it (ADR 2026-10-25 §Q7). */
function audience(rows: Array<{ userId: string }>) {
  mockResolveStaffRouting.mockResolvedValue({
    recipients: rows.map(({ userId }) => ({ userId, paths: ["personal"] })),
    suppressed: [],
    groupChat: { send: false, reason: "not_applicable" },
  });
}

import { prisma } from "@/lib/db";
import { dispatch } from "../dispatch/dispatcher";
import {
  announceRelease,
  resolveReleaseAudience,
  setReleaseSubscription,
  setReleaseNotifyPreference,
  getReleaseSubscribers,
  ensureManagerNotifyDefaults,
  RELEASE_EVENT_TYPE,
  manualReleaseId,
  normalizeManualReleaseNotes,
} from "../release-notify";

const mockCreate = vi.mocked(prisma.releaseAnnouncement.create);
const mockUpdateMany = vi.mocked(prisma.releaseAnnouncement.updateMany);
const mockFindClaim = vi.mocked(prisma.releaseAnnouncement.findUnique);
const mockFindOutgoing = vi.mocked(prisma.outgoingNotification.findMany);
const mockPrefUpsert = vi.mocked(prisma.notificationEventPreference.upsert);
const mockLegacyUpsert = vi.mocked(prisma.notificationPreference.upsert);
const mockChannelUpsert = vi.mocked(prisma.userNotificationChannel.upsert);
const mockUserFindMany = vi.mocked(prisma.user.findMany);
const mockUserFindUnique = vi.mocked(prisma.user.findUnique);
const mockDispatch = vi.mocked(dispatch);

const baseRelease = {
  version: "1.2.0",
  releaseNotes: "- New feature A\n- Fixed bug B",
  commitSha: "abc1234567890",
  deployedAt: "2026-08-13T10:00:00.000Z",
};

function queuedOutcome(id: string) {
  return { status: "queued" as const, outgoingId: id, scheduledFor: new Date() };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreate.mockResolvedValue({} as never);
  mockUpdateMany.mockResolvedValue({ count: 1 });
  mockFindClaim.mockResolvedValue(null);
  mockFindOutgoing.mockResolvedValue([]);
  audience([]);
  mockDispatch.mockResolvedValue(queuedOutcome("out-1"));
});

const counts = { queued: 0, deferred: 0, skipped: 0, failed: 0, previouslyQueued: 0, retryable: false };
const claim = (source: string, recipientCount = 0) => ({ source, recipientCount, announcedAt: new Date("2026-10-30T00:00:00Z") }) as never;
const curated = { ...baseRelease, updateId: manualReleaseId(baseRelease.releaseNotes) };

describe("deployment queue-result handling (AC-RELEASE-5)", () => {
  it.each([
    [{ success: true, data: { status: "queued", queued: 1 } }, true],
    [{ success: true, data: { status: "skipped", reason: "already-announced" } }, true],
    [{ success: true, data: { status: "skipped", reason: "no-recipients" } }, true],
    [{ success: true, data: { status: "skipped", reason: "suppressed" } }, true],
    [{ success: true, data: { status: "error", reason: "enqueue-failed", queued: 0 } }, true],
    [{ success: true, data: { status: "error", reason: "preflight-failed", previouslyQueued: 1 } }, true],
    [{ success: true, data: { status: "error", reason: "outcome-uncertain", queued: 0 } }, true],
    [{ success: true, data: { status: "error", reason: "recording-failed", queued: 1 } }, true],
    [{ success: true, data: { announced: true, queued: 1 } }, true],
    [{ success: true, data: { announced: false, skippedReason: "already-announced" } }, true],
    [{ success: true, data: { status: "error", reason: "preflight-failed", queued: 0, previouslyQueued: 0 } }, false],
    [{ success: true, data: { status: "error", reason: "claim-failed", queued: 0 } }, false],
    [{ success: false }, false],
  ])("actual workflow suppresses fallback appropriately: %j", (response, suppressed) => {
    const workflow = readFileSync(join(process.cwd(), ".github/workflows/deploy.yml"), "utf8");
    const expression = workflow.match(/if echo "\$RESPONSE" \| jq -e '([^']+)'/)?.[1];
    expect(expression).toBeDefined();
    const result = spawnSync("jq", ["-e", expression!], { input: JSON.stringify(response), encoding: "utf8" });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(suppressed ? 0 : 1);
  });
});

function duplicate(source: string, recipientCount = 0) {
  mockCreate.mockRejectedValueOnce({ code: "P2002" });
  mockFindClaim.mockResolvedValueOnce(claim(source, recipientCount));
}

describe("curated identity (AC-RELEASE-1)", () => {
  it.each([
    ["\uFEFF# Heading\r\n> Instruction\r\n\r\n\u00a0- Café\u2003\r\n\uFEFF- Changed\u00a0\r\n-", "- Café\n- Changed"],
    ["# Heading\n\uFEFF> Instruction\n - \n", ""],
  ])("the actual workflow manual block agrees with server normalization", (document, notes) => {
    const workflow = readFileSync(join(process.cwd(), ".github/workflows/deploy.yml"), "utf8");
    const block = workflow.slice(workflow.indexOf("          # --- Step 1:"), workflow.indexOf("          # --- Step 2:"))
      .replace(/^ {10}/gm, "");
    const directory = mkdtempSync(join(tmpdir(), "release-manual-qa-"));
    try {
      mkdirSync(join(directory, "docs/releases"), { recursive: true });
      writeFileSync(join(directory, "docs/releases/current.md"), document);
      const output = execFileSync("bash", ["-eu", "-c", `${block}\nprintf '%s' "$UPDATE_ID"`], { cwd: directory, encoding: "utf8" });
      expect(output.trim().split("\n").at(-1)).toBe(notes ? manualReleaseId(notes) : "");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("normalizes CRLF, outer line whitespace, blank lines and Unicode", () => {
    expect(normalizeManualReleaseNotes("  - Cafe\u0301 \r\n\r\n - Updated  \r")).toBe("- Café\n- Updated");
    expect(manualReleaseId("  - Café\r\n - Updated ")).toBe(manualReleaseId("- Café\n- Updated"));
    expect(manualReleaseId("- Changed")).not.toBe(curated.updateId);
    expect(curated.updateId).toMatch(/^manual:[a-f0-9]{64}$/);
  });

  it("uses a separate manual namespace, retaining the visible version in the payload", async () => {
    audience([{ userId: "u1" }]);
    await announceRelease(curated);
    expect(mockCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ version: curated.updateId, source: "manual:processing" }) });
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ entityId: curated.updateId }));
    expect(mockDispatch.mock.calls[0][0].payload.title).toContain("v1.2.0");
  });

  it("same curated notes stay deduplicated across SHA and version changes", async () => {
    duplicate("manual:complete", 2);
    const result = await announceRelease({ ...curated, version: "2.0.0", commitSha: "fedcba9876543" });
    expect(result).toEqual({ ...counts, status: "skipped", reason: "already-announced", previouslyQueued: 2 });
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockResolveStaffRouting).not.toHaveBeenCalled();
  });

  it("rejects an identity which does not match the notes before creating a claim", async () => {
    await expect(announceRelease({ ...curated, releaseNotes: "Changed" })).rejects.toThrow("identity");
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("announcement queue outcomes (AC-RELEASE-2)", () => {
  it("preserves the legacy version key and counts queued/deferred separately", async () => {
    audience([{ userId: "u1" }, { userId: "u2" }]);
    mockDispatch.mockResolvedValueOnce(queuedOutcome("out-1"))
      .mockResolvedValueOnce({ status: "deferred", outgoingId: "out-2", scheduledFor: new Date() });
    expect(await announceRelease(baseRelease)).toEqual({ ...counts, status: "queued", reason: "queued", queued: 2, deferred: 1 });
    expect(mockCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ version: "1.2.0", source: "deploy:processing" }) });
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ entityId: "1.2.0", eventType: "system.release" }));
    expect(mockUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: { source: "deploy:complete", recipientCount: 2 } }));
  });

  it("keeps historical version claims untouched, even at zero recorded recipients", async () => {
    duplicate("deploy");
    expect(await announceRelease(baseRelease)).toEqual({ ...counts, status: "skipped", reason: "already-announced" });
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("fails closed when claim insertion fails", async () => {
    mockCreate.mockRejectedValueOnce(new Error("connection lost"));
    audience([{ userId: "u1" }]);
    expect(await announceRelease(baseRelease)).toEqual({ ...counts, status: "error", reason: "claim-failed", failed: 1 });
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("does not announce a zero-recipient release and records known-safe retry state", async () => {
    expect(await announceRelease(curated)).toEqual({ ...counts, status: "skipped", reason: "no-recipients", retryable: true });
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: { source: "manual:retryable", recipientCount: 0 } }));
  });

  it("does not report all channel/preference skips as an announcement", async () => {
    audience([{ userId: "u1" }, { userId: "u2" }]);
    mockDispatch.mockResolvedValueOnce({ status: "skipped", reason: "no available channel" })
      .mockResolvedValueOnce({ status: "skipped", reason: "preference disabled" });
    expect(await announceRelease(curated)).toEqual({ ...counts, status: "skipped", reason: "suppressed", skipped: 2, retryable: true });
  });

  it("retains an uncertain claim after all dispatches throw", async () => {
    audience([{ userId: "u1" }]);
    mockDispatch.mockRejectedValueOnce(new Error("unknown queue-write outcome"));
    expect(await announceRelease(curated)).toEqual({ ...counts, status: "error", reason: "enqueue-failed", failed: 1 });
    expect(mockUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: { source: "manual:uncertain", recipientCount: 0 } }));
  });

  it("reports partial queue creation without replaying an uncertain recipient", async () => {
    audience([{ userId: "u1" }, { userId: "u2" }]);
    mockDispatch.mockResolvedValueOnce(queuedOutcome("out-1")).mockRejectedValueOnce(new Error("uncertain"));
    expect(await announceRelease(curated)).toEqual({ ...counts, status: "error", reason: "enqueue-failed", queued: 1, failed: 1 });
    duplicate("manual:uncertain", 1);
    expect(await announceRelease(curated)).toEqual({ ...counts, status: "error", reason: "outcome-uncertain", failed: 1, previouslyQueued: 1 });
    expect(mockDispatch).toHaveBeenCalledTimes(2);
  });

  it("fails closed if final state persistence fails after a queue write", async () => {
    audience([{ userId: "u1" }]);
    mockUpdateMany.mockRejectedValueOnce(new Error("write unknown"));
    expect(await announceRelease(curated)).toEqual({ ...counts, status: "error", reason: "recording-failed", queued: 1, failed: 1 });
  });
});

describe("safe retry and concurrency (AC-RELEASE-3)", () => {
  it("a concurrent duplicate cannot enqueue while the first caller is dispatching", async () => {
    audience([{ userId: "u1" }]);
    let finishDispatch!: (value: ReturnType<typeof queuedOutcome>) => void;
    mockDispatch.mockImplementationOnce(() => new Promise(resolve => { finishDispatch = resolve; }));
    const first = announceRelease(curated);
    await vi.waitFor(() => expect(mockDispatch).toHaveBeenCalledTimes(1));
    mockCreate.mockRejectedValueOnce({ code: "P2002" });
    mockFindClaim.mockResolvedValueOnce({ source: "manual:processing", recipientCount: 0, announcedAt: new Date() } as never);
    expect((await announceRelease(curated)).reason).toBe("in-progress");
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    finishDispatch(queuedOutcome("out-1"));
    expect((await first).queued).toBe(1);
  });

  it("only one of two concurrent safe retries acquires the CAS claim", async () => {
    audience([{ userId: "u1" }]);
    mockCreate.mockRejectedValue({ code: "P2002" });
    mockFindClaim.mockResolvedValue(claim("manual:retryable"));
    mockUpdateMany.mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    const results = await Promise.all([announceRelease(curated), announceRelease(curated)]);
    expect(results.map(result => result.reason).sort()).toEqual(["in-progress", "queued"]);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });

  it("a known empty audience can recover later without resetting any claim", async () => {
    expect((await announceRelease(curated)).reason).toBe("no-recipients");
    duplicate("manual:retryable");
    audience([{ userId: "u1" }]);
    expect((await announceRelease(curated)).queued).toBe(1);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });

  it("retries only currently eligible users with no durable outgoing evidence, regardless of age/status", async () => {
    duplicate("manual:retryable", 1);
    mockFindOutgoing.mockResolvedValueOnce([{ userId: "u1" }, { userId: "u1" }] as never);
    audience([{ userId: "u1" }, { userId: "u2" }, { userId: "u2" }]);
    expect(await announceRelease(curated)).toEqual({ ...counts, status: "queued", reason: "queued", queued: 1, previouslyQueued: 1 });
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ userId: "u2" }));
    expect(mockFindOutgoing).toHaveBeenCalledWith({ where: { eventType: "system.release", entityType: "Release", entityId: curated.updateId }, select: { userId: true } });
    expect(mockUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: { source: "manual:complete", recipientCount: 2 } }));
  });

  it("concurrent retry loser cannot dispatch", async () => {
    duplicate("manual:retryable");
    mockUpdateMany.mockResolvedValueOnce({ count: 0 });
    expect(await announceRelease(curated)).toEqual({ ...counts, status: "skipped", reason: "in-progress" });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("does not take over an interrupted processing claim, even when old", async () => {
    duplicate("manual:processing");
    expect(await announceRelease(curated)).toEqual({ ...counts, status: "error", reason: "outcome-uncertain", failed: 1 });
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("pre-dispatch lookup failure can retry without deleting the claim", async () => {
    mockFindOutgoing.mockRejectedValueOnce(new Error("read failed"));
    expect(await announceRelease(curated)).toEqual({ ...counts, status: "error", reason: "preflight-failed", failed: 1, retryable: true });
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: { source: "manual:retryable", recipientCount: 0 } }));
  });

  it("a failed evidence read during recovery never resends a previous recipient", async () => {
    duplicate("manual:retryable", 1);
    mockFindOutgoing.mockRejectedValueOnce(new Error("read failed"));
    audience([{ userId: "u1" }]);
    expect(await announceRelease(curated)).toEqual({ ...counts, status: "error", reason: "preflight-failed", failed: 1, previouslyQueued: 1, retryable: true });
    expect(mockUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: { source: "manual:retryable", recipientCount: 1 } }));
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("missing historical outgoing rows are uncertain rather than permission to resend", async () => {
    duplicate("manual:retryable", 1);
    audience([{ userId: "u1" }]);
    expect(await announceRelease(curated)).toEqual({ ...counts, status: "error", reason: "outcome-uncertain", failed: 1, previouslyQueued: 1 });
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: { source: "manual:uncertain", recipientCount: 1 } }));
  });
});

describe("resolveReleaseAudience — explicit subscriptions only (ADR §3.3)", () => {
  it("asks the shared resolver for system.release without a module context (ADR 2026-10-25 §Q7)", async () => {
    audience([{ userId: "u1" }]);

    const result = await resolveReleaseAudience();

    expect(mockResolveStaffRouting).toHaveBeenCalledWith({ eventType: "system.release", moduleSlug: null });
    expect(result).toEqual(["u1"]);
  });

  it("a missing preference row is NOT a subscription (empty audience)", async () => {
    audience([]);

    expect(await resolveReleaseAudience()).toEqual([]);
  });
});

describe("setReleaseSubscription (AC-6.4)", () => {
  it("writes both the event preference and the legacy mirror", async () => {
    await setReleaseSubscription("user-1", true);

    expect(mockPrefUpsert).toHaveBeenCalledWith({
      where: { userId_eventType: { userId: "user-1", eventType: "system.release" } },
      create: { userId: "user-1", eventType: "system.release", enabled: true, updatedByUserId: null, updatedVia: null },
      update: { enabled: true, updatedByUserId: null, updatedVia: null },
    });
    expect(mockLegacyUpsert).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      create: { userId: "user-1", notifyReleases: true },
      update: { notifyReleases: true },
    });
  });

  it("opt-out is written to both sources as well", async () => {
    await setReleaseSubscription("user-1", false);

    expect(mockPrefUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { enabled: false, updatedByUserId: null, updatedVia: null } })
    );
    expect(mockLegacyUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { notifyReleases: false } })
    );
  });

  it("legacy export setReleaseNotifyPreference is the very same write path", async () => {
    expect(setReleaseNotifyPreference).toBe(setReleaseSubscription);

    await setReleaseNotifyPreference("user-9", true);

    expect(mockPrefUpsert).toHaveBeenCalledTimes(1);
    expect(mockLegacyUpsert).toHaveBeenCalledTimes(1);
  });
});

describe("ensureManagerNotifyDefaults", () => {
  it("creates the system.release subscription without clobbering an opt-out", async () => {
    mockUserFindUnique.mockResolvedValue({ telegramId: null } as never);

    await ensureManagerNotifyDefaults("user-42");

    expect(mockPrefUpsert).toHaveBeenCalledWith({
      where: { userId_eventType: { userId: "user-42", eventType: "system.release" } },
      create: { userId: "user-42", eventType: "system.release", enabled: true, updatedVia: "system" },
      update: {},
    });
    expect(mockLegacyUpsert).toHaveBeenCalledWith({
      where: { userId: "user-42" },
      create: { userId: "user-42", notifyReleases: true },
      update: {},
    });
  });

  it("provisions a verified Telegram channel when the user has a telegramId", async () => {
    mockUserFindUnique.mockResolvedValue({ telegramId: "555" } as never);

    await ensureManagerNotifyDefaults("user-42");

    expect(mockChannelUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_kind_address: {
            userId: "user-42",
            kind: "TELEGRAM",
            address: "555",
          },
        },
        create: expect.objectContaining({
          kind: "TELEGRAM",
          address: "555",
          priority: 10,
          isActive: true,
        }),
        update: {},
      })
    );
  });

  it("does not touch channels when there is no telegramId", async () => {
    mockUserFindUnique.mockResolvedValue({ telegramId: null } as never);

    await ensureManagerNotifyDefaults("user-42");

    expect(mockChannelUpsert).not.toHaveBeenCalled();
  });

  it("never reactivates an existing channel (update is empty)", async () => {
    mockUserFindUnique.mockResolvedValue({ telegramId: "555" } as never);

    await ensureManagerNotifyDefaults("user-42");

    const call = mockChannelUpsert.mock.calls[0][0];
    expect(call.update).toEqual({});
  });
});

describe("getReleaseSubscribers — reads the new source", () => {
  it("maps an enabled row to notifyReleases=true", async () => {
    mockUserFindMany.mockResolvedValue([
      { id: "u1", notificationEventPrefs: [{ enabled: true }] },
      { id: "u2", notificationEventPrefs: [{ enabled: false }] },
    ] as never);

    expect(await getReleaseSubscribers()).toEqual([
      { id: "u1", notifyReleases: true },
      { id: "u2", notifyReleases: false },
    ]);
  });

  it("treats a missing row as not subscribed (explicit-subscription principle)", async () => {
    mockUserFindMany.mockResolvedValue([
      { id: "u1", notificationEventPrefs: [] },
    ] as never);

    expect(await getReleaseSubscribers()).toEqual([
      { id: "u1", notifyReleases: false },
    ]);
  });

  it("queries only staff accounts and the release event type", async () => {
    mockUserFindMany.mockResolvedValue([] as never);

    await getReleaseSubscribers();

    expect(mockUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: { not: "USER" }, mergedIntoUserId: null },
        select: expect.objectContaining({
          notificationEventPrefs: expect.objectContaining({
            where: { eventType: RELEASE_EVENT_TYPE },
          }),
        }),
      })
    );
  });
});
