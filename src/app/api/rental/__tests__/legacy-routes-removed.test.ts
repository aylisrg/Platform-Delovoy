// #529: /api/rental (root) и /api/rental/[id] были мёртвыми легаси-дубликатами
// /api/rental/offices и /api/rental/offices/[id] — без вызывающего кода в проекте
// (подтверждено grep по src/, bot/ в рамках #527), но их GET не делал role-check,
// так что после фикса #527 (анонимный доступ закрыт) роуты всё ещё отдавали любому
// залогиненному USER полную карточку арендатора (телефон, email, ИНН). Раз нет
// вызывающего кода — роуты удалены целиком; этот тест не даёт им тихо вернуться
// без защиты.
import { describe, it, expect } from "vitest";
import { existsSync } from "fs";
import { join } from "path";

const API_RENTAL_DIR = join(__dirname, "..");

describe("legacy /api/rental и /api/rental/[id] удалены (#529)", () => {
  it("src/app/api/rental/route.ts больше не существует", () => {
    expect(existsSync(join(API_RENTAL_DIR, "route.ts"))).toBe(false);
  });

  it("src/app/api/rental/[id]/route.ts больше не существует", () => {
    expect(existsSync(join(API_RENTAL_DIR, "[id]", "route.ts"))).toBe(false);
  });

  it("/api/rental/offices и /api/rental/offices/[id] (защищённая замена) на месте", () => {
    expect(existsSync(join(API_RENTAL_DIR, "offices", "route.ts"))).toBe(true);
    expect(existsSync(join(API_RENTAL_DIR, "offices", "[id]", "route.ts"))).toBe(true);
  });
});
