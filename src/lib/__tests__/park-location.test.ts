import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PARK_LOCATION } from "../park-location";
import { buildYandexEmbedUrl } from "@/components/ui/yandex-map";

const root = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const OLD_LAT = ["55", "519479"].join(".");
const OLD_LON = ["36", "978566"].join(".");
const CANONICAL_LAT = ["55", "516945"].join(".");

const ALLOW_CANONICAL_LAT = new Set([
  "src/lib/park-location.ts",
  "src/lib/__tests__/park-location.test.ts",
  "src/components/ui/__tests__/yandex-map.test.ts",
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      out.push(...walk(abs));
      continue;
    }
    if (/\.(ts|tsx|js|jsx)$/.test(name)) out.push(abs);
  }
  return out;
}

describe("PARK_LOCATION", () => {
  it("совпадает с карточкой организации «Деловой» в Яндекс Картах", () => {
    expect(PARK_LOCATION).toMatchObject({ orgId: "165904522406", lat: 55.516945, lon: 36.97852 });
    const url = buildYandexEmbedUrl(PARK_LOCATION.lat, PARK_LOCATION.lon, PARK_LOCATION.zoom, PARK_LOCATION.orgId);
    expect(url).toContain("pt=36.97852%2C55.516945%2Cpm2rdl");
  });

  it("карта /gazebos и карта главной берут точку из одной константы", () => {
    for (const f of [
      "src/components/public/gazebos/parking-section.tsx",
      "landing-delovoy-park.ru/components/contacts-section.tsx",
    ]) {
      const src = read(f);
      expect(src).toContain("PARK_LOCATION");
      expect(src).not.toContain(OLD_LAT);
      expect(src).not.toContain(OLD_LON);
    }
  });

  it("JSON-LD /gazebos берёт geo из PARK_LOCATION", () => {
    const src = read("src/app/(public)/gazebos/page.tsx");
    expect(src).toContain("PARK_LOCATION");
    expect(src).toMatch(/latitude:\s*PARK_LOCATION\.lat/);
    expect(src).toMatch(/longitude:\s*PARK_LOCATION\.lon/);
    expect(src).not.toContain(OLD_LAT);
  });

  it("карты, JSON-LD и geo-мета берут точку парка из PARK_LOCATION (#1089)", () => {
    for (const f of [
      "src/app/layout.tsx",
      "src/app/page.tsx",
      "src/app/(public)/avtostoyanka/page.tsx",
      "src/app/(public)/cafe/page.tsx",
      "src/app/(public)/rental/page.tsx",
      "src/app/(public)/parking/page.tsx",
      "src/app/(public)/ps-park/page.tsx",
    ]) {
      const src = read(f);
      expect(src, f).toContain("PARK_LOCATION");
      expect(src, f).not.toContain(OLD_LAT);
      expect(src, f).not.toContain(OLD_LON);
    }
  });

  it("старая и каноническая точка не хардкодятся вне источника координат", () => {
    const roots = ["src", "landing-delovoy-park.ru"].map((d) => join(root, d));
    const offenders: string[] = [];
    for (const dir of roots) {
      for (const abs of walk(dir)) {
        const rel = abs.slice(root.length + 1);
        const src = readFileSync(abs, "utf8");
        if (src.includes(OLD_LAT) || src.includes(OLD_LON)) offenders.push(`${rel} (old)`);
        if (src.includes(CANONICAL_LAT) && !ALLOW_CANONICAL_LAT.has(rel)) offenders.push(`${rel} (canonical)`);
      }
    }
    expect(offenders).toEqual([]);
  });
});