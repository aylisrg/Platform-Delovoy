import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logAudit: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    menuItem: { update: vi.fn(), findFirst: vi.fn() },
  },
}));
vi.mock("@/modules/cafe/service", () => ({ getMenuItem: vi.fn() }));
vi.mock("@/modules/cafe/image-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/cafe/image-storage")>();
  return {
    ...actual,
    saveMenuImage: vi.fn(),
    deleteMenuImage: vi.fn(),
    getMenuImagePath: vi.fn(),
  };
});

import { POST as uploadImage } from "../[id]/image/route";
import { GET as serveImage } from "../images/[filename]/route";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getMenuItem } from "@/modules/cafe/service";
import {
  saveMenuImage,
  deleteMenuImage,
  getMenuImagePath,
} from "@/modules/cafe/image-storage";

const superadmin = { user: { id: "s1", role: "SUPERADMIN" } };

function uploadRequest(file?: File): NextRequest {
  const form = new FormData();
  if (file) form.append("file", file);
  return new NextRequest("http://localhost/api/cafe/menu/item-1/image", {
    method: "POST",
    body: form,
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const fileParams = (filename: string) => ({ params: Promise.resolve({ filename }) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/cafe/menu/[id]/image", () => {
  it("аноним → 401, USER → 403", async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as never);
    expect((await uploadImage(uploadRequest(), params("item-1"))).status).toBe(401);

    vi.mocked(auth).mockResolvedValueOnce({ user: { id: "u1", role: "USER" } } as never);
    expect((await uploadImage(uploadRequest(), params("item-1"))).status).toBe(403);
  });

  it("позиция не найдена → 404", async () => {
    vi.mocked(auth).mockResolvedValue(superadmin as never);
    vi.mocked(getMenuItem).mockResolvedValue(null as never);
    expect((await uploadImage(uploadRequest(), params("missing"))).status).toBe(404);
  });

  it("без файла → 422", async () => {
    vi.mocked(auth).mockResolvedValue(superadmin as never);
    vi.mocked(getMenuItem).mockResolvedValue({ id: "item-1", deletedAt: null } as never);
    const res = await uploadImage(uploadRequest(), params("item-1"));
    expect(res.status).toBe(422);
  });

  it("отказ валидации файла (MIME/magic bytes) → 422 с сообщением", async () => {
    vi.mocked(auth).mockResolvedValue(superadmin as never);
    vi.mocked(getMenuItem).mockResolvedValue({ id: "item-1", deletedAt: null } as never);
    vi.mocked(saveMenuImage).mockRejectedValue(new Error("Допустимые форматы: PNG, JPG, WEBP"));

    const file = new File(["fake"], "x.gif", { type: "image/gif" });
    const res = await uploadImage(uploadRequest(file), params("item-1"));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.message).toContain("Допустимые форматы");
  });

  it("успех: сохраняет файл, удаляет прежний, пишет served-путь в imageUrl", async () => {
    vi.mocked(auth).mockResolvedValue(superadmin as never);
    vi.mocked(getMenuItem).mockResolvedValue({
      id: "item-1",
      deletedAt: null,
      imageUrl: "/api/cafe/menu/images/item-1-100.png",
    } as never);
    vi.mocked(saveMenuImage).mockResolvedValue("item-1-200.webp");
    vi.mocked(prisma.menuItem.update).mockResolvedValue({ id: "item-1" } as never);

    const file = new File(["img"], "photo.webp", { type: "image/webp" });
    const res = await uploadImage(uploadRequest(file), params("item-1"));

    expect(res.status).toBe(200);
    expect(deleteMenuImage).toHaveBeenCalledWith("item-1-100.png");
    expect(prisma.menuItem.update).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { imageUrl: "/api/cafe/menu/images/item-1-200.webp" },
    });
    const body = await res.json();
    expect(body.data.imageUrl).toBe("/api/cafe/menu/images/item-1-200.webp");
  });
});

describe("GET /api/cafe/menu/images/[filename]", () => {
  it("файл не привязан к позиции в БД → 404 (защита от перебора)", async () => {
    vi.mocked(prisma.menuItem.findFirst).mockResolvedValue(null as never);
    const res = await serveImage(
      new NextRequest("http://localhost/api/cafe/menu/images/unknown.png"),
      fileParams("unknown.png")
    );
    expect(res.status).toBe(404);
  });

  it("привязан, но файла нет на диске → 404", async () => {
    vi.mocked(prisma.menuItem.findFirst).mockResolvedValue({ id: "item-1" } as never);
    vi.mocked(getMenuImagePath).mockReturnValue("/nonexistent/dir/item-1.png");
    const res = await serveImage(
      new NextRequest("http://localhost/api/cafe/menu/images/item-1.png"),
      fileParams("item-1.png")
    );
    expect(res.status).toBe(404);
  });
});
