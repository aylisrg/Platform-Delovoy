import { describe, it, expect, vi, beforeEach } from "vitest";

// --- hoisted mocks ---

const { mockUserUpdate, mockUserFindMany, mockUNCUpsert, mockAutoMerge, mockNormalizePhone } =
  vi.hoisted(() => ({
    mockUserUpdate: vi.fn(),
    mockUserFindMany: vi.fn(),
    mockUNCUpsert: vi.fn(),
    mockAutoMerge: vi.fn(),
    mockNormalizePhone: vi.fn(),
  }));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { update: mockUserUpdate, findMany: mockUserFindMany },
    userNotificationChannel: { upsert: mockUNCUpsert },
  },
}));

vi.mock("@/lib/phone", () => ({
  normalizePhone: mockNormalizePhone,
}));

vi.mock("@/modules/auth/auto-merge", () => ({
  autoMergeOnLogin: mockAutoMerge,
}));

import { handleVkIdSignIn } from "../vk-id-authorize";
import type { VkIdProfile } from "@/lib/auth-providers/vk-id";

const BASE_PROFILE: VkIdProfile = {
  user: {
    id: 123456,
    first_name: "Ivan",
    last_name: "Petrov",
    email: "ivan@example.com",
    phone: "+79001234567",
    avatar: "https://vk.com/avatar.jpg",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VK_COMMUNITY_TOKEN", "");
  mockNormalizePhone.mockReturnValue("+79001234567");
  mockUserUpdate.mockResolvedValue({});
  mockUserFindMany.mockResolvedValue([]);
  mockUNCUpsert.mockResolvedValue({});
  mockAutoMerge.mockResolvedValue({ kind: "no_candidates" });
});

describe("handleVkIdSignIn", () => {
  it("updates user with vkId, source, phone and avatar", async () => {
    await handleVkIdSignIn("user-1", BASE_PROFILE);
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: expect.objectContaining({
        vkId: "123456",
        source: "vk_id",
        phone: "+79001234567",
        phoneNormalized: "+79001234567",
        image: "https://vk.com/avatar.jpg",
      }),
    });
  });

  it("omits phone fields when phone is null", async () => {
    mockNormalizePhone.mockReturnValue(null);
    const profile: VkIdProfile = { user: { id: 999 } };
    await handleVkIdSignIn("user-2", profile);
    const data = mockUserUpdate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("phone");
    expect(data).not.toHaveProperty("phoneNormalized");
  });

  it("skips UNC upsert when VK_COMMUNITY_TOKEN is not set", async () => {
    await handleVkIdSignIn("user-1", BASE_PROFILE);
    expect(mockUNCUpsert).not.toHaveBeenCalled();
  });

  it("creates UserNotificationChannel when VK_COMMUNITY_TOKEN is set", async () => {
    vi.stubEnv("VK_COMMUNITY_TOKEN", "community-token");
    await handleVkIdSignIn("user-1", BASE_PROFILE);
    expect(mockUNCUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_kind_address: { userId: "user-1", kind: "VK", address: "123456" } },
        create: expect.objectContaining({ userId: "user-1", kind: "VK", address: "123456" }),
      })
    );
  });

  it("calls autoMergeOnLogin with phone match candidates", async () => {
    mockUserFindMany.mockResolvedValueOnce([{ id: "old-user", role: "USER" }]);
    mockUserFindMany.mockResolvedValueOnce([]);
    await handleVkIdSignIn("user-new", BASE_PROFILE);
    expect(mockAutoMerge).toHaveBeenCalledWith({
      primaryUserId: "user-new",
      candidates: [{ id: "old-user", role: "USER", matchedBy: "phone" }],
      provider: "vk-id",
    });
  });

  it("calls autoMergeOnLogin with email match candidates when no phone match", async () => {
    mockUserFindMany.mockResolvedValueOnce([]); // no phone match
    mockUserFindMany.mockResolvedValueOnce([{ id: "email-user", role: "USER" }]);
    await handleVkIdSignIn("user-new", BASE_PROFILE);
    expect(mockAutoMerge).toHaveBeenCalledWith({
      primaryUserId: "user-new",
      candidates: [{ id: "email-user", role: "USER", matchedBy: "email" }],
      provider: "vk-id",
    });
  });

  it("does not call autoMergeOnLogin when no candidates", async () => {
    mockUserFindMany.mockResolvedValue([]);
    await handleVkIdSignIn("user-solo", BASE_PROFILE);
    expect(mockAutoMerge).not.toHaveBeenCalled();
  });

  it("excludes current userId from merge candidate queries", async () => {
    mockUserFindMany.mockResolvedValue([]);
    await handleVkIdSignIn("user-self", BASE_PROFILE);
    const calls = mockUserFindMany.mock.calls;
    for (const call of calls) {
      const where = call[0].where;
      expect(where.id?.notIn).toContain("user-self");
    }
  });

  it("normalizePhone is called with the raw phone from profile", async () => {
    await handleVkIdSignIn("user-1", BASE_PROFILE);
    expect(mockNormalizePhone).toHaveBeenCalledWith("+79001234567");
  });
});
