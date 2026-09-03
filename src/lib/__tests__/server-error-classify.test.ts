import { describe, it, expect } from "vitest";
import { isClientInducedFrameworkError } from "../server-error-classify";

describe("isClientInducedFrameworkError (issue #717)", () => {
  it.each([
    "The router state header was sent but could not be parsed.",
    "Invariant: Expected RSC response, got text/plain. This is a bug in Next.js.",
    "Invariant: Expected RSC response, got text/html. This is a bug in Next.js.",
    'Failed to find Server Action "abc". This request might be from an older or newer deployment.',
  ])("узнаёт задокументированный текст Next.js: %s", (message) => {
    expect(isClientInducedFrameworkError(message)).toBe(true);
  });

  it.each([
    "Cannot read properties of undefined (reading 'id')",
    "Invariant: attempted to hard navigate to the same URL",
    "PrismaClientKnownRequestError: Unique constraint failed",
    "",
  ])("всё остальное — настоящая ошибка: %s", (message) => {
    expect(isClientInducedFrameworkError(message)).toBe(false);
  });
});
