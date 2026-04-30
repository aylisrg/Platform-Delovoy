import { describe, it, expect } from "vitest";

import { buildWelcomeText, mainMenuKeyboard } from "../handlers/welcome";

describe("buildWelcomeText", () => {
  it("includes the user's first name when provided (default branch)", () => {
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

  it("uses the returning-user greeting when isReturning=true", () => {
    const text = buildWelcomeText("Илья", true);
    expect(text).toContain("С возвращением, Илья!");
    expect(text).toContain("Твой аккаунт уже подключён");
    // Body still includes the modules list.
    expect(text).toContain("Барбекю Парк");
  });

  it("uses the default greeting when isReturning=false", () => {
    const text = buildWelcomeText("Илья", false);
    expect(text).toContain("Привет, Илья!");
    expect(text).not.toContain("С возвращением");
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

  it("uses the provided loginUrl on the 'Открыть сайт' URL button", () => {
    const customUrl = "https://app.example.com/auth/tg-callback?token=abc";
    const kb = mainMenuKeyboard(customUrl);
    const flat = kb.inline_keyboard.flat();
    const urlButton = flat.find(
      (b) => "url" in b && b.text.includes("Открыть сайт")
    );
    expect(urlButton).toBeDefined();
    expect((urlButton as { url: string }).url).toBe(customUrl);
  });

  it("falls back to APP_URL when loginUrl is not supplied", () => {
    const kb = mainMenuKeyboard();
    const flat = kb.inline_keyboard.flat();
    const urlButton = flat.find(
      (b) => "url" in b && b.text.includes("Открыть сайт")
    );
    expect(urlButton).toBeDefined();
    // Fallback URL is APP_URL — never empty.
    expect((urlButton as { url: string }).url.length).toBeGreaterThan(0);
  });
});
