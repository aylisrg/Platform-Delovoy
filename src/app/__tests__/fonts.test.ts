import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";

// #495: next/font/google скачивает шрифты во время `npm run build` — сбой
// доступа к Google Fonts валит прод-сборку целиком (падало 2026-08-12).
// Шрифты переведены на next/font/local (src/app/fonts/*.woff2); эти тесты
// не дают регрессии обратно на сетевую зависимость на этапе сборки.
const APP_DIR = join(__dirname, "..");
const FONTS_DIR = join(APP_DIR, "fonts");

function listTsxFilesRecursive(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name.startsWith(".") || entry.name === "__tests__") return [];
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return listTsxFilesRecursive(full);
    if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) return [full];
    return [];
  });
}

const GOOGLE_FONT_IMPORT = /from\s+["']next\/font\/google["']/;

describe("fonts — no next/font/google dependency (#495)", () => {
  it("no file under src/app imports from next/font/google", () => {
    const files = listTsxFilesRecursive(APP_DIR);
    const offenders = files.filter((f) => GOOGLE_FONT_IMPORT.test(readFileSync(f, "utf-8")));
    expect(offenders).toEqual([]);
  });

  it("layout.tsx and webapp/layout.tsx use next/font/local", () => {
    const rootLayout = readFileSync(join(APP_DIR, "layout.tsx"), "utf-8");
    const webappLayout = readFileSync(join(APP_DIR, "webapp", "layout.tsx"), "utf-8");
    expect(rootLayout).toContain("next/font/local");
    expect(webappLayout).toContain("next/font/local");
  });

  it("all referenced local font files exist on disk", () => {
    for (const weight of ["400", "500", "600", "700"]) {
      expect(existsSync(join(FONTS_DIR, `inter-${weight}.woff2`))).toBe(true);
      expect(existsSync(join(FONTS_DIR, `manrope-${weight}.woff2`))).toBe(true);
    }
  });

  it("local font files are non-trivial in size (not empty/corrupt placeholders)", () => {
    for (const file of readdirSync(FONTS_DIR)) {
      if (!file.endsWith(".woff2")) continue;
      const { size } = require("fs").statSync(join(FONTS_DIR, file));
      expect(size).toBeGreaterThan(10_000);
    }
  });
});
