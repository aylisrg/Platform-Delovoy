import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    mergeCandidate: {
      upsert: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}));

const { mockMergeClients } = vi.hoisted(() => ({
  mockMergeClients: vi.fn(),
}));

vi.mock("@/modules/clients/service", () => ({
  mergeClients: mockMergeClients,
}));

import { prisma } from "@/lib/db";
import { autoMergeOnLogin } from "../auto-merge";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.mergeCandidate.upsert).mockResolvedValue({} as never);
  vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
  mockMergeClients.mockResolvedValue({
    primaryId: "primary-1",
    deletedUserId: "secondary-1",
    tombstonedUserId: "secondary-1",
    merged: { bookings: 0 },
  });
});

describe("autoMergeOnLogin", () => {
  it("returns no_candidates when candidates list is empty", async () => {
    const res = await autoMergeOnLogin({
      primaryUserId: "primary-1",
      candidates: [],
      provider: "telegram-token",
    });
    expect(res).toEqual({ kind: "no_candidates" });
    expect(mockMergeClients).not.toHaveBeenCalled();
    expect(prisma.mergeCandidate.upsert).not.toHaveBeenCalled();
  });

  it("filters out the primary user from candidates", async () => {
    // Primary "primary-1" appears in candidates — must be ignored.
    const res = await autoMergeOnLogin({
      primaryUserId: "primary-1",
      candidates: [{ id: "primary-1", role: "USER", matchedBy: "phone" }],
      provider: "telegram-token",
    });
    expect(res).toEqual({ kind: "no_candidates" });
    expect(mockMergeClients).not.toHaveBeenCalled();
  });

  it("soft-merges when there is exactly one USER candidate", async () => {
    const res = await autoMergeOnLogin({
      primaryUserId: "primary-1",
      candidates: [{ id: "secondary-1", role: "USER", matchedBy: "phone" }],
      provider: "telegram-token",
    });

    expect(res).toEqual({
      kind: "merged",
      secondaryUserId: "secondary-1",
      matchedBy: "phone",
    });
    expect(mockMergeClients).toHaveBeenCalledWith(
      "primary-1",
      "secondary-1",
      "primary-1"
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "auth.merge.auto",
          metadata: expect.objectContaining({
            provider: "telegram-token",
            matchedBy: "phone",
            secondaryUserId: "secondary-1",
          }),
        }),
      })
    );
  });

  it("skips admin candidates and logs skipped_admin", async () => {
    const res = await autoMergeOnLogin({
      primaryUserId: "primary-1",
      candidates: [{ id: "manager-1", role: "MANAGER", matchedBy: "phone" }],
      provider: "telegram-token",
    });
    expect(res).toEqual({
      kind: "skipped_admin",
      secondaryUserId: "manager-1",
      role: "MANAGER",
    });
    expect(mockMergeClients).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "auth.merge.skipped_admin",
        }),
      })
    );
  });

  it("skips SUPERADMIN candidates", async () => {
    const res = await autoMergeOnLogin({
      primaryUserId: "primary-1",
      candidates: [{ id: "super-1", role: "SUPERADMIN", matchedBy: "email" }],
      provider: "magic-link",
    });
    expect(res.kind).toBe("skipped_admin");
    expect(mockMergeClients).not.toHaveBeenCalled();
  });

  it("on ≥2 candidates writes MergeCandidate rows and logs conflict", async () => {
    const res = await autoMergeOnLogin({
      primaryUserId: "primary-1",
      candidates: [
        { id: "alt-1", role: "USER", matchedBy: "phone" },
        { id: "alt-2", role: "USER", matchedBy: "email" },
      ],
      provider: "telegram-token",
    });

    expect(res).toEqual({
      kind: "conflict",
      candidateUserIds: ["alt-1", "alt-2"],
    });
    expect(mockMergeClients).not.toHaveBeenCalled();
    expect(prisma.mergeCandidate.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "auth.merge.conflict",
          metadata: expect.objectContaining({
            candidateUserIds: ["alt-1", "alt-2"],
          }),
        }),
      })
    );
  });

  it("MergeCandidate writes use stable pair ordering (id<id)", async () => {
    await autoMergeOnLogin({
      primaryUserId: "zzz-primary",
      candidates: [
        { id: "aaa-cand-1", role: "USER", matchedBy: "phone" },
        { id: "bbb-cand-2", role: "USER", matchedBy: "email" },
      ],
      provider: "telegram-token",
    });

    const calls = vi.mocked(prisma.mergeCandidate.upsert).mock.calls;
    for (const call of calls) {
      const where = call[0].where as {
        primaryUserId_candidateUserId: { primaryUserId: string; candidateUserId: string };
      };
      const { primaryUserId, candidateUserId } = where.primaryUserId_candidateUserId;
      // Stable order: alphabetic ascending so upsert key is symmetric.
      expect(primaryUserId < candidateUserId).toBe(true);
    }
  });

  it("dedups duplicate candidate ids in the input list", async () => {
    const res = await autoMergeOnLogin({
      primaryUserId: "primary-1",
      candidates: [
        { id: "secondary-1", role: "USER", matchedBy: "phone" },
        { id: "secondary-1", role: "USER", matchedBy: "email" }, // duplicate id
      ],
      provider: "telegram-token",
    });
    // After dedup we have exactly one candidate → still merges.
    expect(res.kind).toBe("merged");
    expect(mockMergeClients).toHaveBeenCalledTimes(1);
  });
});
