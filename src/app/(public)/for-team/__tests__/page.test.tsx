import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const mockAuth = vi.fn();
const mockGetUserAdminSections = vi.fn();
const mockRedirect = vi.fn((url: string) => {
  // next/navigation.redirect() бросает — эмулируем, иначе код после гейта
  // продолжит выполняться и тест не заметит дырку в защите.
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock("@/lib/auth", () => ({ auth: () => mockAuth() }));
vi.mock("@/lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/permissions")>();
  return {
    ...actual,
    getUserAdminSections: (...args: unknown[]) => mockGetUserAdminSections(...args),
  };
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => mockRedirect(url) }));
vi.mock("@landing/components/navbar", () => ({ Navbar: () => null }));
vi.mock("@landing/components/footer", () => ({ Footer: () => null }));

import ForTeamPage from "../page";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUserAdminSections.mockResolvedValue([]);
});

/**
 * Рендерит дерево, которое вернул серверный компонент, и собирает href.
 * Именно рендер, а не обход props: вложенные компоненты (карточка «нет
 * доступа») иначе остались бы нераскрытыми, и тест бы их не увидел.
 */
function collectHrefs(node: ReactElement): string[] {
  const html = renderToStaticMarkup(node);
  return [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
}

describe("/for-team — гейт авторизации", () => {
  it("гостя уводит на /auth/signin с возвратом на /for-team", async () => {
    mockAuth.mockResolvedValue(null);

    await expect(ForTeamPage()).rejects.toThrow(
      "NEXT_REDIRECT:/auth/signin?callbackUrl=%2Ffor-team",
    );
    expect(mockGetUserAdminSections).not.toHaveBeenCalled();
  });

  it("не ходит в БД за секциями для роли USER", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "u1", role: "USER", name: "Гость", email: "g@example.com" },
    });

    await ForTeamPage();

    expect(mockRedirect).not.toHaveBeenCalled();
    expect(mockGetUserAdminSections).not.toHaveBeenCalled();
  });

  it("USER не получает ни одной ссылки в /admin/*", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "u1", role: "USER", name: "Гость", email: "g@example.com" },
    });

    const hrefs = collectHrefs(await ForTeamPage());

    expect(hrefs.some((h) => h.startsWith("/admin/"))).toBe(false);
    expect(hrefs).toContain("/dashboard");
  });
});

describe("/for-team — состав карточек", () => {
  it("MANAGER видит ссылки только на выданные секции", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "m1", role: "MANAGER", name: "Менеджер", email: "m@example.com" },
    });
    mockGetUserAdminSections.mockResolvedValue(["cafe", "inventory"]);

    const hrefs = collectHrefs(await ForTeamPage());
    const adminHrefs = hrefs.filter((h) => h.startsWith("/admin/")).sort();

    expect(mockGetUserAdminSections).toHaveBeenCalledWith("m1");
    expect(adminHrefs).toEqual(["/admin/cafe", "/admin/inventory"]);
  });

  it("MANAGER без грантов не получает ссылок в админку", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "m2", role: "MANAGER", name: "Новичок", email: "n@example.com" },
    });
    mockGetUserAdminSections.mockResolvedValue([]);

    const hrefs = collectHrefs(await ForTeamPage());

    expect(hrefs.some((h) => h.startsWith("/admin/"))).toBe(false);
  });

  it("SUPERADMIN получает и секции вне грида прав, и без заглушки /admin/sauna", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "s1", role: "SUPERADMIN", name: "Владелец", email: "s@example.com" },
    });
    mockGetUserAdminSections.mockResolvedValue([
      "dashboard",
      "cafe",
      "monitoring",
      "sauna",
    ]);

    const hrefs = collectHrefs(await ForTeamPage());

    expect(hrefs).toEqual(
      expect.arrayContaining([
        "/admin/dashboard",
        "/admin/cafe",
        "/admin/monitoring",
        "/admin/payments",
        "/admin/feedback",
        "/admin/notifications",
      ]),
    );
    expect(hrefs).not.toContain("/admin/sauna");
  });
});
