/**
 * Smoke tests for bot/index.ts wiring.
 *
 * We don't boot the bot (that would require a real TELEGRAM_BOT_TOKEN);
 * instead we statically verify that the index file no longer contains the
 * stub callbackQuery handlers that used to swallow domain callbacks.
 *
 * If you ever re-introduce stubs that only call `answerCallbackQuery()`
 * for menu:gazebos / menu:ps-park / menu:cafe / menu:my-bookings,
 * this test will fail and remind you why we removed them
 * (see: returning-users bug, fix/bot-returning-users PR).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const indexSource = readFileSync(
  resolve(__dirname, "..", "index.ts"),
  "utf-8"
);

describe("bot/index.ts wiring", () => {
  it.each([
    ["menu:gazebos"],
    ["menu:ps-park"],
    ["menu:cafe"],
    ["menu:my-bookings"],
  ])(
    "does NOT register a stub callbackQuery handler for %s in index.ts",
    (cb) => {
      // Domain handlers (gazebos.ts, ps-park.ts, cafe.ts, my-bookings.ts)
      // own these callbacks. Any registration in index.ts would shadow them.
      const pattern = new RegExp(
        `bot\\.callbackQuery\\(['"]${cb.replace(/[-/.]/g, "\\$&")}['"]`
      );
      expect(indexSource).not.toMatch(pattern);
    }
  );

  it("registers the catch-all unknown-text handler", () => {
    expect(indexSource).toMatch(/registerUnknownTextHandler\(bot/);
  });

  it("registers the catch-all AFTER all domain handlers", () => {
    const idxUnknown = indexSource.indexOf("registerUnknownTextHandler(bot");
    const idxGazebos = indexSource.indexOf("registerGazeboHandlers(bot");
    const idxPs = indexSource.indexOf("registerPSParkHandlers(bot");
    const idxCafe = indexSource.indexOf("registerCafeHandlers(bot");
    const idxMyBookings = indexSource.indexOf("registerMyBookingsHandler(bot");

    expect(idxUnknown).toBeGreaterThan(idxGazebos);
    expect(idxUnknown).toBeGreaterThan(idxPs);
    expect(idxUnknown).toBeGreaterThan(idxCafe);
    expect(idxUnknown).toBeGreaterThan(idxMyBookings);
  });

  it("uses the shared buildWelcomeText for the default /start branch", () => {
    expect(indexSource).toMatch(/buildWelcomeText\(ctx\.from\?\.first_name\)/);
  });
});
