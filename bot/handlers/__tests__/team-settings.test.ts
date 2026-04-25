import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/modules/notifications/release-notify", () => ({
  setReleaseNotifyPreference: vi.fn(),
}));

import { prisma } from "@/lib/db";
import {
  getTeamUser,
  settingsKeyboard,
  settingsText,
} from "../team-settings";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getTeamUser — role guard", () => {
  it("returns user data for SUPERADMIN", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u-1",
      role: "SUPERADMIN",
      notificationPreference: { notifyReleases: true },
    } as never);

    const result = await getTeamUser("12345");

    expect(result).toEqual({ id: "u-1", notifyReleases: true });
  });

  it("returns user data for MANAGER", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u-2",
      role: "MANAGER",
      notificationPreference: { notifyReleases: false },
    } as never);

    const result = await getTeamUser("12345");

    expect(result).toEqual({ id: "u-2", notifyReleases: false });
  });

  it("returns null for regular USER (the team-only invariant)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u-3",
      role: "USER",
      notificationPreference: { notifyReleases: true },
    } as never);

    const result = await getTeamUser("12345");

    expect(result).toBeNull();
  });

  it("returns null when user not linked to platform account", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);

    const result = await getTeamUser("12345");

    expect(result).toBeNull();
  });

  it("treats missing notificationPreference as notifyReleases=false (opt-in default)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u-4",
      role: "MANAGER",
      notificationPreference: null,
    } as never);

    const result = await getTeamUser("12345");

    expect(result).toEqual({ id: "u-4", notifyReleases: false });
  });
});

describe("settingsKeyboard", () => {
  it("renders ВЫКЛ + 'on' callback when notifications are off", () => {
    const kb = settingsKeyboard(false);
    const row = kb.inline_keyboard[0];
    expect(row[0].text).toContain("ВЫКЛ");
    expect("callback_data" in row[0] ? row[0].callback_data : "").toBe(
      "settings:releases:on",
    );
  });

  it("renders ВКЛ + 'off' callback when notifications are on", () => {
    const kb = settingsKeyboard(true);
    const row = kb.inline_keyboard[0];
    expect(row[0].text).toContain("ВКЛ");
    expect("callback_data" in row[0] ? row[0].callback_data : "").toBe(
      "settings:releases:off",
    );
  });
});

describe("settingsText", () => {
  it("reflects current state in the message", () => {
    expect(settingsText(true)).toContain("включены");
    expect(settingsText(false)).toContain("выключены");
  });
});
