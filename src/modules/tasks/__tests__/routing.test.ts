import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    taskCategory: { findUnique: vi.fn() },
    module: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
  },
}));

const { prisma } = await import("@/lib/db");
const {
  resolveAssignee,
  getGlobalFallbackAssignee,
  categorizeByKeywords,
} = await import("../routing");

beforeEach(() => {
  vi.clearAllMocks();
  // default: global fallback absent
  (prisma.module.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
});

describe("resolveAssignee", () => {
  it("uses category.defaultAssigneeUserId when category is active and set", async () => {
    (prisma.taskCategory.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      defaultAssigneeUserId: "u-plumber",
      isActive: true,
    });
    expect(await resolveAssignee("cat-plumbing")).toBe("u-plumber");
  });

  it("falls back to global when category has no default assignee", async () => {
    (prisma.taskCategory.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      defaultAssigneeUserId: null,
      isActive: true,
    });
    (prisma.module.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      config: { fallbackAssigneeUserId: "u-duty" },
    });
    expect(await resolveAssignee("cat-plumbing")).toBe("u-duty");
  });

  it("falls back to global when category is inactive", async () => {
    (prisma.taskCategory.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      defaultAssigneeUserId: "u-was",
      isActive: false,
    });
    (prisma.module.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      config: { fallbackAssigneeUserId: "u-duty" },
    });
    expect(await resolveAssignee("cat-plumbing")).toBe("u-duty");
  });

  it("returns null when no category and no global fallback", async () => {
    (prisma.module.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect(await resolveAssignee(null)).toBeNull();
  });

  it("returns null when category id is unknown and no global fallback", async () => {
    (prisma.taskCategory.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.module.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect(await resolveAssignee("cat-ghost")).toBeNull();
  });
});

describe("getGlobalFallbackAssignee", () => {
  it("returns string when present in Module.config", async () => {
    (prisma.module.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      config: { fallbackAssigneeUserId: "u-duty" },
    });
    expect(await getGlobalFallbackAssignee()).toBe("u-duty");
  });

  it("returns null when config is missing or key is empty", async () => {
    (prisma.module.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      config: {},
    });
    expect(await getGlobalFallbackAssignee()).toBeNull();

    (prisma.module.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      config: { fallbackAssigneeUserId: "" },
    });
    expect(await getGlobalFallbackAssignee()).toBeNull();

    (prisma.module.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    expect(await getGlobalFallbackAssignee()).toBeNull();
  });
});

describe("categorizeByKeywords", () => {
  it("returns null when no text / no keyword match", async () => {
    (prisma.taskCategory as unknown as { findMany: ReturnType<typeof vi.fn> }).findMany =
      vi.fn().mockResolvedValue([
        { id: "c1", keywords: ["протечк", "кран"] },
      ]);
    expect(await categorizeByKeywords("")).toBeNull();
    expect(await categorizeByKeywords("обычное сообщение")).toBeNull();
  });

  it("matches case-insensitively on any keyword", async () => {
    (prisma.taskCategory as unknown as { findMany: ReturnType<typeof vi.fn> }).findMany =
      vi.fn().mockResolvedValue([
        { id: "c-plumbing", keywords: ["протечк", "кран"] },
        { id: "c-electric", keywords: ["свет", "розетк"] },
      ]);
    expect(await categorizeByKeywords("У нас ПРОТЕЧКА!")).toBe("c-plumbing");
    expect(await categorizeByKeywords("Нет света в офисе")).toBe("c-electric");
  });

  it("returns the first matching category", async () => {
    (prisma.taskCategory as unknown as { findMany: ReturnType<typeof vi.fn> }).findMany =
      vi.fn().mockResolvedValue([
        { id: "c-first", keywords: ["общее"] },
        { id: "c-second", keywords: ["общее"] },
      ]);
    expect(await categorizeByKeywords("общее слово")).toBe("c-first");
  });
});
