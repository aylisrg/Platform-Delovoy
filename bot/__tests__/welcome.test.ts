import { describe, it, expect } from "vitest";

import { buildWelcomeText, mainMenuKeyboard } from "../handlers/welcome";

describe("buildWelcomeText", () => {
  it("includes the user's first name when provided (returning user)", () => {
    const text = buildWelcomeText("Илья");
    expect(text).toContain("Привет, Илья!");
    expect(text).toContain("«Деловой»");
  });

  it("falls back to a friendly default when first name is missing", () => {
    const text = buildWelcomeText(undefined);
    expect(text).toContain("Привет, друг!");
  });

  it("falls back to the default for empty / whitespace first name", () => {
    expect(buildWelcomeText("")).toContain("Привет, друг!");
    expect(buildWelcomeText("   ")).toContain("Привет, друг!");
    expect(buildWelcomeText(null)).toContain("Привет, друг!");
  });

  it("mentions all primary park modules so the user knows what's available", () => {
    const text = buildWelcomeText("Анна");
    expect(text).toContain("Барбекю Парк");
    expect(text).toContain("Плей Парк");
    expect(text).toContain("бронирования");
  });
});

describe("mainMenuKeyboard", () => {
  it("contains buttons for the main park modules", () => {
    const kb = mainMenuKeyboard();
    const flat = kb.inline_keyboard.flat();
    const callbacks = flat
      .map((b) => ("callback_data" in b ? b.callback_data : null))
      .filter(Boolean);

    expect(callbacks).toContain("menu:gazebos");
    expect(callbacks).toContain("menu:ps-park");
    expect(callbacks).toContain("menu:my-bookings");
  });

  it("exposes the Mini App entrypoint", () => {
    const kb = mainMenuKeyboard();
    const flat = kb.inline_keyboard.flat();
    const hasWebApp = flat.some((b) => "web_app" in b);
    expect(hasWebApp).toBe(true);
  });
});
