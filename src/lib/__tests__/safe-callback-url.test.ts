import { describe, it, expect } from "vitest";
import { safeCallbackUrl } from "@/lib/safe-callback-url";

const ORIGIN = "https://delovoy-park.ru";

describe("safeCallbackUrl", () => {
  it("пропускает обычный внутренний путь", () => {
    expect(safeCallbackUrl("/for-team", ORIGIN)).toBe("/for-team");
    expect(safeCallbackUrl("/admin/cafe?tab=orders#top", ORIGIN)).toBe(
      "/admin/cafe?tab=orders#top",
    );
    expect(safeCallbackUrl("/", ORIGIN)).toBe("/");
  });

  it("схлопывает абсолютный URL своего origin до пути", () => {
    expect(safeCallbackUrl(`${ORIGIN}/admin/gazebos?d=2026-09-18`, ORIGIN)).toBe(
      "/admin/gazebos?d=2026-09-18",
    );
  });

  it("отклоняет абсолютный URL чужого origin", () => {
    expect(safeCallbackUrl("https://evil.com/phish", ORIGIN)).toBeNull();
    expect(safeCallbackUrl("http://delovoy-park.ru.evil.com/", ORIGIN)).toBeNull();
  });

  it("отклоняет абсолютный URL, когда origin неизвестен", () => {
    expect(safeCallbackUrl(`${ORIGIN}/admin`, null)).toBeNull();
  });

  it("отклоняет protocol-relative URL — это и есть open redirect", () => {
    expect(safeCallbackUrl("//evil.com", ORIGIN)).toBeNull();
    expect(safeCallbackUrl("//evil.com/path", ORIGIN)).toBeNull();
  });

  it("отклоняет backslash-вариант protocol-relative URL", () => {
    expect(safeCallbackUrl("/\\evil.com", ORIGIN)).toBeNull();
    expect(safeCallbackUrl("/\\/evil.com", ORIGIN)).toBeNull();
  });

  it("отклоняет значения с управляющими символами", () => {
    expect(safeCallbackUrl("/\tfor-team", ORIGIN)).toBeNull();
    expect(safeCallbackUrl("/for-team\n", ORIGIN)).toBeNull();
  });

  it("отклоняет относительные и схемные значения", () => {
    expect(safeCallbackUrl("for-team", ORIGIN)).toBeNull();
    expect(safeCallbackUrl("javascript:alert(1)", ORIGIN)).toBeNull();
    expect(safeCallbackUrl("mailto:a@b.c", ORIGIN)).toBeNull();
  });

  it("отклоняет пустое значение", () => {
    expect(safeCallbackUrl(null, ORIGIN)).toBeNull();
    expect(safeCallbackUrl(undefined, ORIGIN)).toBeNull();
    expect(safeCallbackUrl("", ORIGIN)).toBeNull();
  });
});

/**
 * BUG-3, найден qa-engineer в раунде 2 PR #916.
 *
 * Ветка абсолютных URL схлопывала свой origin до `pathname` и возвращала его
 * СРАЗУ, не прогоняя через проверки путевой ветки. `https://<наш-домен>//evil`
 * проходил сверку origin, а `pathname` у него — `//evil`, то есть снова
 * protocol-relative. Ссылка выглядела целиком нашей и уводила на чужой домен —
 * ровно та дыра, которую эта функция закрывает.
 *
 * Первый набор тестов это пропустил: проверялись `//evil.com` как голый путь и
 * `https://evil.com` как чужой origin, но не СВОЙ origin с путём-обманкой.
 */
describe("safeCallbackUrl — свой origin с protocol-relative путём (BUG-3)", () => {
  it.each([
    "https://delovoy-park.ru//evil.example.com",
    "https://delovoy-park.ru//evil.example.com/deep?a=1#f",
    "HTTPS://delovoy-park.ru//evil.example.com",
  ])("отклоняет %s", (raw) => {
    expect(safeCallbackUrl(raw, ORIGIN)).toBeNull();
  });

  it.each([
    "https://delovoy-park.ru/\\evil.example.com",
    "https://delovoy-park.ru/\\/evil.example.com",
  ])("отклоняет backslash-вариант %s (new URL нормализует \\ в /)", (raw) => {
    expect(safeCallbackUrl(raw, ORIGIN)).toBeNull();
  });

  it("но обычный абсолютный URL своего origin по-прежнему работает", () => {
    expect(safeCallbackUrl(`${ORIGIN}/for-team`, ORIGIN)).toBe("/for-team");
    expect(safeCallbackUrl(`${ORIGIN}/admin/cafe?tab=1#top`, ORIGIN)).toBe(
      "/admin/cafe?tab=1#top",
    );
  });

  it("голый origin без пути схлопывается в корень", () => {
    expect(safeCallbackUrl(ORIGIN, ORIGIN)).toBe("/");
  });
});
