import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    releaseAnnouncement: {
      create: vi.fn(),
      update: vi.fn(),
    },
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

import { prisma } from "@/lib/db";
import { log } from "@/lib/logger";
import { dispatch } from "../dispatch/dispatcher";
import {
  announceRelease,
  resolveReleaseAudience,
  setReleaseSubscription,
  setReleaseNotifyPreference,
  getReleaseSubscribers,
  ensureManagerNotifyDefaults,
  RELEASE_EVENT_TYPE,
} from "../release-notify";

const mockCreate = vi.mocked(prisma.releaseAnnouncement.create);
const mockUpdate = vi.mocked(prisma.releaseAnnouncement.update);
const mockPrefFindMany = vi.mocked(prisma.notificationEventPreference.findMany);
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
  mockUpdate.mockResolvedValue({} as never);
  mockPrefFindMany.mockResolvedValue([] as never);
  mockDispatch.mockResolvedValue(queuedOutcome("out-1"));
});

describe("announceRelease — claim (AC-6.1, 6.2)", () => {
  it("claims the version and dispatches to every subscriber", async () => {
    mockPrefFindMany.mockResolvedValue([
      { userId: "u1" },
      { userId: "u2" },
    ] as never);

    const result = await announceRelease(baseRelease);

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        version: "1.2.0",
        commitSha: "abc1234567890",
        releaseNotes: "- New feature A\n- Fixed bug B",
        source: "deploy",
      }),
    });
    expect(mockDispatch).toHaveBeenCalledTimes(2);
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        eventType: "system.release",
        entityType: "Release",
        entityId: "1.2.0",
      })
    );
    expect(result).toEqual({ status: "announced", queued: 2 });
  });

  it("payload carries version, short sha and the notes", async () => {
    mockPrefFindMany.mockResolvedValue([{ userId: "u1" }] as never);

    await announceRelease(baseRelease);

    const event = mockDispatch.mock.calls[0][0];
    expect(event.payload.title).toContain("v1.2.0");
    expect(event.payload.body).toContain("abc1234");
    expect(event.payload.body).toContain("New feature A");
  });

  it("audits the announcement with an INFO SystemEvent", async () => {
    mockPrefFindMany.mockResolvedValue([
      { userId: "u1" },
      { userId: "u2" },
    ] as never);

    await announceRelease(baseRelease);

    expect(log.info).toHaveBeenCalledWith(
      "release-notify",
      expect.stringContaining("1.2.0"),
      expect.objectContaining({ version: "1.2.0", queued: 2, audience: 2 })
    );
  });

  it("stores the recipient count on the claimed row", async () => {
    mockPrefFindMany.mockResolvedValue([
      { userId: "u1" },
      { userId: "u2" },
    ] as never);

    await announceRelease(baseRelease);

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { version: "1.2.0" },
      data: { recipientCount: 2 },
    });
  });

  it("does not count dispatches the dispatcher skipped", async () => {
    mockPrefFindMany.mockResolvedValue([
      { userId: "u1" },
      { userId: "u2" },
    ] as never);
    mockDispatch
      .mockResolvedValueOnce(queuedOutcome("out-1"))
      .mockResolvedValueOnce({ status: "skipped", reason: "no available channel" });

    const result = await announceRelease(baseRelease);

    expect(result).toEqual({ status: "announced", queued: 1 });
  });

  it("survives a single failing dispatch and still announces the rest", async () => {
    mockPrefFindMany.mockResolvedValue([
      { userId: "u1" },
      { userId: "u2" },
    ] as never);
    mockDispatch
      .mockRejectedValueOnce(new Error("channel exploded"))
      .mockResolvedValueOnce(queuedOutcome("out-2"));

    const result = await announceRelease(baseRelease);

    expect(result).toEqual({ status: "announced", queued: 1 });
  });

  it("announces with zero recipients when nobody is subscribed", async () => {
    mockPrefFindMany.mockResolvedValue([] as never);

    const result = await announceRelease(baseRelease);

    expect(mockDispatch).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "announced", queued: 0 });
  });
});

describe("announceRelease — repeat of the same version (AC-6.1, 6.2, 6.7)", () => {
  it("skips silently on P2002 and never dispatches", async () => {
    mockCreate.mockRejectedValue({ code: "P2002" });
    mockPrefFindMany.mockResolvedValue([{ userId: "u1" }] as never);

    const result = await announceRelease(baseRelease);

    expect(result).toEqual({ status: "skipped", reason: "already-announced" });
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("logs an INFO SystemEvent when the duplicate is blocked", async () => {
    mockCreate.mockRejectedValue({ code: "P2002" });

    await announceRelease(baseRelease);

    expect(log.info).toHaveBeenCalledWith(
      "release-notify",
      expect.stringContaining("1.2.0"),
      expect.objectContaining({ version: "1.2.0", commitSha: "abc1234567890" })
    );
    expect(log.warn).not.toHaveBeenCalled();
  });
});

describe("announceRelease — fail-open on a non-P2002 error (AC-6.6)", () => {
  it("still dispatches when the claim itself failed", async () => {
    mockCreate.mockRejectedValue(new Error("connection refused"));
    mockPrefFindMany.mockResolvedValue([{ userId: "u1" }] as never);

    const result = await announceRelease(baseRelease);

    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: "announced", queued: 1 });
  });

  it("logs a WARNING and does not touch the (non-existent) row", async () => {
    mockCreate.mockRejectedValue(new Error("connection refused"));
    mockPrefFindMany.mockResolvedValue([{ userId: "u1" }] as never);

    await announceRelease(baseRelease);

    expect(log.warn).toHaveBeenCalledWith(
      "release-notify",
      expect.stringContaining("1.2.0"),
      expect.objectContaining({ version: "1.2.0" })
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("does not fail the announcement when the recipient count cannot be stored", async () => {
    mockPrefFindMany.mockResolvedValue([{ userId: "u1" }] as never);
    mockUpdate.mockRejectedValue(new Error("write conflict"));

    await expect(announceRelease(baseRelease)).resolves.toEqual({
      status: "announced",
      queued: 1,
    });
  });
});

describe("resolveReleaseAudience — explicit subscriptions only (ADR §3.3)", () => {
  it("reads enabled rows of staff users, excluding merged accounts", async () => {
    mockPrefFindMany.mockResolvedValue([{ userId: "u1" }] as never);

    const audience = await resolveReleaseAudience();

    expect(mockPrefFindMany).toHaveBeenCalledWith({
      where: {
        eventType: "system.release",
        enabled: true,
        user: { role: { not: "USER" }, mergedIntoUserId: null },
      },
      select: { userId: true },
    });
    expect(audience).toEqual(["u1"]);
  });

  it("a missing preference row is NOT a subscription (empty audience)", async () => {
    mockPrefFindMany.mockResolvedValue([] as never);

    expect(await resolveReleaseAudience()).toEqual([]);
  });

  it("opted-out (enabled:false) and USER rows are filtered by the query, not in JS", async () => {
    mockPrefFindMany.mockResolvedValue([{ userId: "u1" }] as never);

    await resolveReleaseAudience();

    const where = mockPrefFindMany.mock.calls[0][0]?.where as {
      enabled: boolean;
      user: { role: { not: string } };
    };
    expect(where.enabled).toBe(true);
    expect(where.user.role).toEqual({ not: "USER" });
  });
});

describe("setReleaseSubscription (AC-6.4)", () => {
  it("writes both the event preference and the legacy mirror", async () => {
    await setReleaseSubscription("user-1", true);

    expect(mockPrefUpsert).toHaveBeenCalledWith({
      where: { userId_eventType: { userId: "user-1", eventType: "system.release" } },
      create: { userId: "user-1", eventType: "system.release", enabled: true },
      update: { enabled: true },
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
      expect.objectContaining({ update: { enabled: false } })
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
      create: { userId: "user-42", eventType: "system.release", enabled: true },
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
